import {
  createRenderer,
  createHydrationRenderer,
  warn,
  RootRenderFunction,
  CreateAppFunction,
  Renderer,
  HydrationRenderer,
  App,
  RootHydrateFunction
} from '@vue/runtime-core'
import { nodeOps } from './nodeOps'
import { patchProp, forcePatchProp } from './patchProp'
// Importing from the compiler, will be tree-shaken in prod
import { isFunction, isString, isHTMLTag, isSVGTag, extend } from '@vue/shared'

declare module '@vue/reactivity' {
  export interface RefUnwrapBailTypes {
    // Note: if updating this, also update `types/refBail.d.ts`.
    runtimeDOMBailTypes: Node | Window
  }
}
// vue定义的底层渲染方法,比如更新属性，操作dom
const rendererOptions = extend({ patchProp, forcePatchProp }, nodeOps)

// lazy create the renderer - this makes core renderer logic tree-shakable
// in case the user only imports reactivity utilities from Vue.
let renderer: Renderer<Element> | HydrationRenderer

let enabledHydration = false
// 延时创建渲染器，当用户只依赖响应式包时，可以通过tree-shaking移除核心渲染逻辑相关（具体啥情况，不知道）
function ensureRenderer() {
  // 这里createRenderer可以自定义渲染器的底层机制, 只需自己重写rendererOptions里的方法即可， 但方法名不可变
  return renderer || (renderer = createRenderer<Node, Element>(rendererOptions))
}

function ensureHydrationRenderer() {
  renderer = enabledHydration
    ? renderer
    : createHydrationRenderer(rendererOptions)
  enabledHydration = true
  return renderer as HydrationRenderer
}

// use explicit type casts here to avoid import() calls in rolled-up d.ts
export const render = ((...args) => {
  ensureRenderer().render(...args)
}) as RootRenderFunction<Element>

export const hydrate = ((...args) => {
  ensureHydrationRenderer().hydrate(...args)
}) as RootHydrateFunction
// vue的真实创建app入口
export const createApp = ((...args) => {
  // ensureRenderer方法， 用户可以重新定义
  const app = ensureRenderer().createApp(...args)

  if (__DEV__) {
    injectNativeTagCheck(app)
  }
  // 拿出原有的mount方法， 下步进行方法重写
  const { mount } = app
  // createApp 创建的app 挂载方法, 这里是对mount的重写， 做了操作后， 再调用原有的mount方法， 和vue2中一样
  // 重写的目的是，原有的mount中是可跨平台的代码，与某一平台相关的操作（像web的dom操作等）在重写mount中执行
  app.mount = (containerOrSelector: Element | string): any => {
    // 获取dom 这里可以传字符串选择器或者 DOM 对象，但如果是字符串选择器，就需要把它转成 DOM 对象，作为最终挂载的容器
    const container = normalizeContainer(containerOrSelector)
    // 没传有效的container， 不进行挂载过程
    if (!container) return
    const component = app._component
    // 如组件对象没有定义 render 函数和 template 模板，则取容器的 innerHTML 作为组件模板内容
    if (!isFunction(component) && !component.render && !component.template) {
      component.template = container.innerHTML
    }
    // clear content before mounting
    // 挂载前，先清空
    container.innerHTML = ''
    // 这里进行了第一次挂载
    const proxy = mount(container)
    // 挂载后删除v-cloak属性,v-cloak是开发者为防止大括号闪烁设置属性选择器的样式
    container.removeAttribute('v-cloak')
    // data-v-app 干嘛的现在不知道
    container.setAttribute('data-v-app', '')
    return proxy
  }

  return app
}) as CreateAppFunction<Element>
// vue ssr的真实创建app入口
export const createSSRApp = ((...args) => {
  const app = ensureHydrationRenderer().createApp(...args)

  if (__DEV__) {
    injectNativeTagCheck(app)
  }

  const { mount } = app
  app.mount = (containerOrSelector: Element | string): any => {
    const container = normalizeContainer(containerOrSelector)
    if (container) {
      return mount(container, true)
    }
  }

  return app
}) as CreateAppFunction<Element>

function injectNativeTagCheck(app: App) {
  // Inject `isNativeTag`
  // this is used for component name validation (dev only)
  Object.defineProperty(app.config, 'isNativeTag', {
    value: (tag: string) => isHTMLTag(tag) || isSVGTag(tag),
    writable: false
  })
}
// 如果是字符串说明是选择器， 就获取dom 否则就是真是dom直接返回
function normalizeContainer(container: Element | string): Element | null {
  if (isString(container)) {
    const res = document.querySelector(container)
    if (__DEV__ && !res) {
      warn(`Failed to mount app: mount target selector returned null.`)
    }
    return res
  }
  return container
}

// SFC CSS utilities
export { useCssModule } from './helpers/useCssModule'
export { useCssVars } from './helpers/useCssVars'

// DOM-only components
export { Transition, TransitionProps } from './components/Transition'
export {
  TransitionGroup,
  TransitionGroupProps
} from './components/TransitionGroup'

// **Internal** DOM-only runtime directive helpers
export {
  vModelText,
  vModelCheckbox,
  vModelRadio,
  vModelSelect,
  vModelDynamic
} from './directives/vModel'
export { withModifiers, withKeys } from './directives/vOn'
export { vShow } from './directives/vShow'

// re-export everything from core
// h, Component, reactivity API, nextTick, flags & types
export * from '@vue/runtime-core'
