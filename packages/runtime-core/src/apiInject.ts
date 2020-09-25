import { isFunction } from '@vue/shared'
import { currentInstance } from './component'
import { currentRenderingInstance } from './componentRenderUtils'
import { warn } from './warning'

export interface InjectionKey<T> extends Symbol { }

export function provide<T>(key: InjectionKey<T> | string, value: T) {
  if (!currentInstance) {
    if (__DEV__) {
      warn(`provide() can only be used inside setup().`)
    }
  } else {
    let provides = currentInstance.provides
    // by default an instance inherits its parent's provides object
    // but when it needs to provide values of its own, it creates its
    // own provides object using parent provides object as prototype.
    // this way in `inject` we can simply look up injections from direct
    // parent and let the prototype chain do the work.
    const parentProvides =
      currentInstance.parent && currentInstance.parent.provides
    // 因为在组件初始化时，如果当前组件存在父组件就把当前组件的provides赋值为父组件的provides
    // 所以这里可以判断是否是同一个内存地址判断相等
    if (parentProvides === provides) {// 只会在第一次在当前组件内使用provide才会相等
      // 创建一个负组件provides的原型链， 当前组件provides中不存在的key会去父组件中的provides查找
      provides = currentInstance.provides = Object.create(parentProvides)
    }
    // TS doesn't allow symbol as index type
    // 当前组件注册的provides赋值
    provides[key as string] = value
  }
}

export function inject<T>(key: InjectionKey<T> | string): T | undefined
export function inject<T>(
  key: InjectionKey<T> | string,
  defaultValue: T,
  treatDefaultAsFactory?: false
): T
export function inject<T>(
  key: InjectionKey<T> | string,
  defaultValue: T | (() => T),
  treatDefaultAsFactory: true
): T
export function inject(
  key: InjectionKey<any> | string,
  defaultValue?: unknown,
  treatDefaultAsFactory = false
) {
  // fallback to `currentRenderingInstance` so that this can be called in
  // a functional component
  const instance = currentInstance || currentRenderingInstance
  if (instance) {
    const provides = instance.provides
    if ((key as string | symbol) in provides) {
      // TS doesn't allow symbol as index type
      return provides[key as string]
    } else if (arguments.length > 1) {
      return treatDefaultAsFactory && isFunction(defaultValue)
        ? defaultValue()
        : defaultValue
    } else if (__DEV__) {
      warn(`injection "${String(key)}" not found.`)
    }
  } else if (__DEV__) {
    warn(`inject() can only be used inside setup() or functional components.`)
  }
}
