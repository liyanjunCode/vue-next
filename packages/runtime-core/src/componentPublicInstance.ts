import { ComponentInternalInstance, Data } from './component'
import { nextTick, queueJob } from './scheduler'
import { instanceWatch, WatchOptions, WatchStopHandle } from './apiWatch'
import {
  EMPTY_OBJ,
  hasOwn,
  isGloballyWhitelisted,
  NOOP,
  extend,
  isString
} from '@vue/shared'
import {
  ReactiveEffect,
  toRaw,
  shallowReadonly,
  ReactiveFlags,
  track,
  TrackOpTypes,
  ShallowUnwrapRef
} from '@vue/reactivity'
import {
  ExtractComputedReturns,
  ComponentOptionsBase,
  ComputedOptions,
  MethodOptions,
  ComponentOptionsMixin,
  OptionTypesType,
  OptionTypesKeys,
  resolveMergedOptions,
  isInBeforeCreate
} from './componentOptions'
import { EmitsOptions, EmitFn } from './componentEmits'
import { Slots } from './componentSlots'
import {
  currentRenderingInstance,
  markAttrsAccessed
} from './componentRenderUtils'
import { warn } from './warning'
import { UnionToIntersection } from './helpers/typeUtils'

/**
 * Custom properties added to component instances in any way and can be accessed through `this`
 *
 * @example
 * Here is an example of adding a property `$router` to every component instance:
 * ```ts
 * import { createApp } from 'vue'
 * import { Router, createRouter } from 'vue-router'
 *
 * declare module '@vue/runtime-core' {
 *   interface ComponentCustomProperties {
 *     $router: Router
 *   }
 * }
 *
 * // effectively adding the router to every component instance
 * const app = createApp({})
 * const router = createRouter()
 * app.config.globalProperties.$router = router
 *
 * const vm = app.mount('#app')
 * // we can access the router from the instance
 * vm.$router.push('/')
 * ```
 */
export interface ComponentCustomProperties { }

type IsDefaultMixinComponent<T> = T extends ComponentOptionsMixin
  ? ComponentOptionsMixin extends T ? true : false
  : false

type MixinToOptionTypes<T> = T extends ComponentOptionsBase<
  infer P,
  infer B,
  infer D,
  infer C,
  infer M,
  infer Mixin,
  infer Extends,
  any,
  any,
  infer Defaults
>
  ? OptionTypesType<P & {}, B & {}, D & {}, C & {}, M & {}, Defaults & {}> &
  IntersectionMixin<Mixin> &
  IntersectionMixin<Extends>
  : never

// ExtractMixin(map type) is used to resolve circularly references
type ExtractMixin<T> = {
  Mixin: MixinToOptionTypes<T>
}[T extends ComponentOptionsMixin ? 'Mixin' : never]

type IntersectionMixin<T> = IsDefaultMixinComponent<T> extends true
  ? OptionTypesType<{}, {}, {}, {}, {}>
  : UnionToIntersection<ExtractMixin<T>>

type UnwrapMixinsType<
  T,
  Type extends OptionTypesKeys
  > = T extends OptionTypesType ? T[Type] : never

type EnsureNonVoid<T> = T extends void ? {} : T

export type ComponentPublicInstanceConstructor<
  T extends ComponentPublicInstance<
    Props,
    RawBindings,
    D,
    C,
    M
  > = ComponentPublicInstance<any>,
  Props = any,
  RawBindings = any,
  D = any,
  C extends ComputedOptions = ComputedOptions,
  M extends MethodOptions = MethodOptions
  > = {
    __isFragment?: never
    __isTeleport?: never
    __isSuspense?: never
    new(...args: any[]): T
  }

export type CreateComponentPublicInstance<
  P = {},
  B = {},
  D = {},
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  Mixin extends ComponentOptionsMixin = ComponentOptionsMixin,
  Extends extends ComponentOptionsMixin = ComponentOptionsMixin,
  E extends EmitsOptions = {},
  PublicProps = P,
  Defaults = {},
  MakeDefaultsOptional extends boolean = false,
  PublicMixin = IntersectionMixin<Mixin> & IntersectionMixin<Extends>,
  PublicP = UnwrapMixinsType<PublicMixin, 'P'> & EnsureNonVoid<P>,
  PublicB = UnwrapMixinsType<PublicMixin, 'B'> & EnsureNonVoid<B>,
  PublicD = UnwrapMixinsType<PublicMixin, 'D'> & EnsureNonVoid<D>,
  PublicC extends ComputedOptions = UnwrapMixinsType<PublicMixin, 'C'> &
  EnsureNonVoid<C>,
  PublicM extends MethodOptions = UnwrapMixinsType<PublicMixin, 'M'> &
  EnsureNonVoid<M>,
  PublicDefaults = UnwrapMixinsType<PublicMixin, 'Defaults'> &
  EnsureNonVoid<Defaults>
  > = ComponentPublicInstance<
    PublicP,
    PublicB,
    PublicD,
    PublicC,
    PublicM,
    E,
    PublicProps,
    PublicDefaults,
    MakeDefaultsOptional,
    ComponentOptionsBase<P, B, D, C, M, Mixin, Extends, E, string, Defaults>
  >

// public properties exposed on the proxy, which is used as the render context
// in templates (as `this` in the render option)
export type ComponentPublicInstance<
  P = {}, // props type extracted from props option
  B = {}, // raw bindings returned from setup()
  D = {}, // return from data()
  C extends ComputedOptions = {},
  M extends MethodOptions = {},
  E extends EmitsOptions = {},
  PublicProps = P,
  Defaults = {},
  MakeDefaultsOptional extends boolean = false,
  Options = ComponentOptionsBase<any, any, any, any, any, any, any, any, any>
  > = {
    $: ComponentInternalInstance
    $data: D
    $props: MakeDefaultsOptional extends true
    ? Partial<Defaults> & Omit<P & PublicProps, keyof Defaults>
    : P & PublicProps
    $attrs: Data
    $refs: Data
    $slots: Slots
    $root: ComponentPublicInstance | null
    $parent: ComponentPublicInstance | null
    $emit: EmitFn<E>
    $el: any
    $options: Options
    $forceUpdate: ReactiveEffect
    $nextTick: typeof nextTick
    $watch(
      source: string | Function,
      cb: Function,
      options?: WatchOptions
    ): WatchStopHandle
  } & P &
  ShallowUnwrapRef<B> &
  D &
  ExtractComputedReturns<C> &
  M &
  ComponentCustomProperties

type PublicPropertiesMap = Record<string, (i: ComponentInternalInstance) => any>

/**
 * #2437 In Vue 3, functional components do not have a public instance proxy but
 * they exist in the internal parent chain. For code that relies on traversing
 * public $parent chains, skip functional ones and go to the parent instead.
 */
const getPublicInstance = (
  i: ComponentInternalInstance | null
): ComponentPublicInstance | null =>
  i && (i.proxy ? i.proxy : getPublicInstance(i.parent))

const publicPropertiesMap: PublicPropertiesMap = extend(Object.create(null), {
  $: i => i,
  $el: i => i.vnode.el,
  $data: i => i.data,
  $props: i => (__DEV__ ? shallowReadonly(i.props) : i.props),
  $attrs: i => (__DEV__ ? shallowReadonly(i.attrs) : i.attrs),
  $slots: i => (__DEV__ ? shallowReadonly(i.slots) : i.slots),
  $refs: i => (__DEV__ ? shallowReadonly(i.refs) : i.refs),
  $parent: i => getPublicInstance(i.parent),
  $root: i => i.root && i.root.proxy,
  $emit: i => i.emit,
  $options: i => (__FEATURE_OPTIONS_API__ ? resolveMergedOptions(i) : i.type),
  $forceUpdate: i => () => queueJob(i.update),
  $nextTick: i => nextTick.bind(i.proxy!),
  $watch: i => (__FEATURE_OPTIONS_API__ ? instanceWatch.bind(i) : NOOP)
} as PublicPropertiesMap)

const enum AccessTypes {
  SETUP,
  DATA,
  PROPS,
  CONTEXT,
  OTHER
}

export interface ComponentRenderContext {
  [key: string]: any
  _: ComponentInternalInstance
}
//instance.ctx 设置setupState、ctx、data、props 等数据代理的拦截器函数
export const PublicInstanceProxyHandlers: ProxyHandler<any> = {
  get({ _: instance }: ComponentRenderContext, key: string) {
    const {
      ctx,
      setupState,
      data,
      props,
      accessCache,
      type,
      appContext
    } = instance

    // let @vue/reactivity know it should never observe Vue public instances.
    if (key === ReactiveFlags.SKIP) {
      return true
    }

    // for internal formatters to know that this is a Vue instance
    if (__DEV__ && key === '__isVue') {
      return true
    }

    // data / props / ctx
    // This getter gets called for every property access on the render context
    // during render and is a major hotspot. The most expensive part of this
    // is the multiple hasOwn() calls. It's much faster to do a simple property
    // access on a plain object, so we use an accessCache object (with null
    // prototype) to memoize what access type a key corresponds to.
    let normalizedProps
    // key 不是$开头的情况，这部分数据可能是 setupState、data、props、ctx 中的一种
    if (key[0] !== '$') {
      // setupState / data / props / ctx
      // 渲染代理的属性访问缓存中
      //如果 key 不以 $ 开头，那么就依次判断 setupState、data、props、ctx 中是否包含这个 key，
      //如果包含就返回对应值。注意这个判断顺序很重要，在 key 相同时它会决定数据获取的优先级
      // accessCache 缓存是为了优化， 因为对象访问key比hasOwn去判断key是否存在代价小，速度快，只需每个key
      // 值第一次判断是否在对象上存在获取数据key进行缓存， 下一次知道key是存在的直接读取对象数据， 
      const n = accessCache![key]
      // 从缓存中取
      if (n !== undefined) {
        switch (n) {
          case AccessTypes.SETUP:
            return setupState[key]
          case AccessTypes.DATA:
            return data[key]
          case AccessTypes.CONTEXT:
            return ctx[key]
          case AccessTypes.PROPS:
            return props![key]
          // default: just fallthrough
        }
        // 从 setupState 中取数据
      } else if (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) {
        accessCache![key] = AccessTypes.SETUP
        return setupState[key]
      } else if (data !== EMPTY_OBJ && hasOwn(data, key)) {
        // 从 data 中取数据
        accessCache![key] = AccessTypes.DATA
        return data[key]
      } else if (
        // only cache other properties when instance has declared (thus stable)
        // props
        (normalizedProps = instance.propsOptions[0]) &&
        hasOwn(normalizedProps, key)
      ) {
        // 从 props 中取数据
        accessCache![key] = AccessTypes.PROPS
        return props![key]
      } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
        // 从 ctx 中取数据
        accessCache![key] = AccessTypes.CONTEXT
        return ctx[key]
      } else if (!__FEATURE_OPTIONS_API__ || !isInBeforeCreate) {
        // 都取不到
        accessCache![key] = AccessTypes.OTHER
      }
    }
    // 用于判断是不是vue公开的属性或方法（比如 $parent）
    const publicGetter = publicPropertiesMap[key]
    let cssModule, globalProperties
    // public $xxx properties
    if (publicGetter) {
      // 公开的 $xxx 属性或方法
      if (key === '$attrs') {
        track(instance, TrackOpTypes.GET, key)
        __DEV__ && markAttrsAccessed()
      }
      return publicGetter(instance)
    } else if (
      // css module (injected by vue-loader)
      // css 模块，通过 vue-loader 编译的时候注入
      (cssModule = type.__cssModules) &&
      (cssModule = cssModule[key])
    ) {
      return cssModule
    } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
      // user may set custom properties to `this` that start with `$`
      // 用户自定义的属性，也用 `$` 开头
      accessCache![key] = AccessTypes.CONTEXT
      return ctx[key]
    } else if (
      // global properties
      // 全局定义的属性
      ((globalProperties = appContext.config.globalProperties),
        hasOwn(globalProperties, key))
    ) {
      return globalProperties[key]
    } else if (
      __DEV__ &&
      currentRenderingInstance &&
      (!isString(key) ||
        // #1091 avoid internal isRef/isVNode checks on component instance leading
        // to infinite warning loop
        key.indexOf('__v') !== 0)
    ) {
      if (
        data !== EMPTY_OBJ &&
        (key[0] === '$' || key[0] === '_') &&
        hasOwn(data, key)
      ) {
        // 如果在 data 中定义的数据以 $ 开头，会报警告，因为 $ 是保留字符，不会做代理
        warn(
          `Property ${JSON.stringify(
            key
          )} must be accessed via $data because it starts with a reserved ` +
          `character ("$" or "_") and is not proxied on the render context.`
        )
      } else {
        // 在模板中使用的变量如果没有定义，报警告
        warn(
          `Property ${JSON.stringify(key)} was accessed during render ` +
          `but is not defined on instance.`
        )
      }
    }
  },

  set(
    { _: instance }: ComponentRenderContext,
    key: string,
    value: any
  ): boolean {
    const { data, setupState, ctx } = instance
    if (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) {
      // 给 setupState 赋值
      setupState[key] = value
    } else if (data !== EMPTY_OBJ && hasOwn(data, key)) {
      // 给 data 赋值
      data[key] = value
    } else if (key in instance.props) {  // 不能直接给 props 赋值
      __DEV__ &&
        warn(
          `Attempting to mutate prop "${key}". Props are readonly.`,
          instance
        )
      return false
    }
    if (key[0] === '$' && key.slice(1) in instance) { // 不能给 Vue 内部以 $ 开头的保留属性赋值
      __DEV__ &&
        warn(
          `Attempting to mutate public property "${key}". ` +
          `Properties starting with $ are reserved and readonly.`,
          instance
        )
      return false
    } else {
      if (__DEV__ && key in instance.appContext.config.globalProperties) {
        Object.defineProperty(ctx, key, {
          enumerable: true,
          configurable: true,
          value
        })
      } else {
        // 用户自定义数据赋值， 就是不用做响应式的数据
        ctx[key] = value
      }
    }
    return true
  },
  // 当我们判断属性是否存在于 instance.ctx 渲染上下文中时，就会进入 has 函数
  has(
    {
      _: { data, setupState, accessCache, ctx, appContext, propsOptions }
    }: ComponentRenderContext,
    key: string
  ) {
    let normalizedProps
    // 这个函数的实现很简单，依次判断 key 是否存在于 accessCache、data、setupState、props 、用户数据、
    // 公开属性以及全局属性中，然后返回结果。
    return (
      accessCache![key] !== undefined ||
      (data !== EMPTY_OBJ && hasOwn(data, key)) ||
      (setupState !== EMPTY_OBJ && hasOwn(setupState, key)) ||
      ((normalizedProps = propsOptions[0]) && hasOwn(normalizedProps, key)) ||
      hasOwn(ctx, key) ||
      hasOwn(publicPropertiesMap, key) ||
      hasOwn(appContext.config.globalProperties, key)
    )
  }
}

if (__DEV__ && !__TEST__) {
  PublicInstanceProxyHandlers.ownKeys = (target: ComponentRenderContext) => {
    warn(
      `Avoid app logic that relies on enumerating keys on a component instance. ` +
      `The keys will be empty in production mode to avoid performance overhead.`
    )
    return Reflect.ownKeys(target)
  }
}

export const RuntimeCompiledPublicInstanceProxyHandlers = extend(
  {},
  PublicInstanceProxyHandlers,
  {
    get(target: ComponentRenderContext, key: string) {
      // fast path for unscopables when using `with` block
      if ((key as any) === Symbol.unscopables) {
        return
      }
      return PublicInstanceProxyHandlers.get!(target, key, target)
    },
    has(_: ComponentRenderContext, key: string) {
      // 如果 key 以 _ 开头或者 key 在全局变量白名单内，则 has 为 false
      const has = key[0] !== '_' && !isGloballyWhitelisted(key)
      if (__DEV__ && !has && PublicInstanceProxyHandlers.has!(_, key)) {
        warn(
          `Property ${JSON.stringify(
            key
          )} should not start with _ which is a reserved prefix for Vue internals.`
        )
      }
      return has
    }
  }
)

// In dev mode, the proxy target exposes the same properties as seen on `this`
// for easier console inspection. In prod mode it will be an empty object so
// these properties definitions can be skipped.
export function createRenderContext(instance: ComponentInternalInstance) {
  const target: Record<string, any> = {}

  // expose internal instance for proxy handlers
  Object.defineProperty(target, `_`, {
    configurable: true,
    enumerable: false,
    get: () => instance
  })

  // expose public properties
  Object.keys(publicPropertiesMap).forEach(key => {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: false,
      get: () => publicPropertiesMap[key](instance),
      // intercepted by the proxy so no need for implementation,
      // but needed to prevent set errors
      set: NOOP
    })
  })

  // expose global properties
  const { globalProperties } = instance.appContext.config
  Object.keys(globalProperties).forEach(key => {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: false,
      get: () => globalProperties[key],
      set: NOOP
    })
  })

  return target as ComponentRenderContext
}

// dev only
export function exposePropsOnRenderContext(
  instance: ComponentInternalInstance
) {
  const {
    ctx,
    propsOptions: [propsOptions]
  } = instance
  if (propsOptions) {
    Object.keys(propsOptions).forEach(key => {
      Object.defineProperty(ctx, key, {
        enumerable: true,
        configurable: true,
        get: () => instance.props[key],
        set: NOOP
      })
    })
  }
}

// dev only
export function exposeSetupStateOnRenderContext(
  instance: ComponentInternalInstance
) {
  const { ctx, setupState } = instance
  Object.keys(toRaw(setupState)).forEach(key => {
    if (key[0] === '$' || key[0] === '_') {
      warn(
        `setup() return property ${JSON.stringify(
          key
        )} should not start with "$" or "_" ` +
        `which are reserved prefixes for Vue internals.`
      )
      return
    }
    Object.defineProperty(ctx, key, {
      enumerable: true,
      configurable: true,
      get: () => setupState[key],
      set: NOOP
    })
  })
}
