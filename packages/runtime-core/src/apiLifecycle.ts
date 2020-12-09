import {
  ComponentInternalInstance,
  currentInstance,
  isInSSRComponentSetup,
  LifecycleHooks,
  setCurrentInstance
} from './component'
import { ComponentPublicInstance } from './componentPublicInstance'
import { callWithAsyncErrorHandling, ErrorTypeStrings } from './errorHandling'
import { warn } from './warning'
import { toHandlerKey } from '@vue/shared'
import { DebuggerEvent, pauseTracking, resetTracking } from '@vue/reactivity'

export { onActivated, onDeactivated } from './components/KeepAlive'

export function injectHook(
  type: LifecycleHooks,
  hook: Function & { __weh?: Function },
  target: ComponentInternalInstance | null = currentInstance,
  prepend: boolean = false
): Function | undefined {
  if (target) {
    const hooks = target[type] || (target[type] = [])
    // cache the error handling wrapper for injected hooks so the same hook
    // can be properly deduped by the scheduler. "__weh" stands for "with error
    // handling".
    // 封装 hook 钩子函数并缓存 
    const wrappedHook =
      hook.__weh ||
      (hook.__weh = (...args: unknown[]) => {
        if (target.isUnmounted) {
          return
        }
        // disable tracking inside all lifecycle hooks
        // since they can potentially be called inside effects.
        // 停止依赖收集 
        // 在后续执行 wrappedHook 函数时，会先停止依赖收集，因为钩子函数内部访问的响应式对象，
        // 通常都已经执行过依赖收集，
        // 所以钩子函数执行的时候没有必要再次收集依赖，毕竟这个过程也有一定的性能消耗。
        pauseTracking()
        // Set currentInstance during hook invocation.
        // This assumes the hook does not synchronously trigger other hooks, which
        // can only be false when the user does something really funky.
        // 设置 target 为当前运行的组件实例 
        setCurrentInstance(target)
        // 执行钩子函数 
        const res = callWithAsyncErrorHandling(hook, target, type, args)
        //函数执行完毕则设置当前运行组件实例为 null，并恢复依赖收集。
        setCurrentInstance(null)
        // 恢复依赖收集 
        resetTracking()
        return res
      })
    if (prepend) {
      hooks.unshift(wrappedHook)
    } else {
      hooks.push(wrappedHook)
    }
    return wrappedHook
  } else if (__DEV__) {
    const apiName = toHandlerKey(ErrorTypeStrings[type].replace(/ hook$/, ''))
    warn(
      `${apiName} is called when there is no active component instance to be ` +
      `associated with. ` +
      `Lifecycle injection APIs can only be used during execution of setup().` +
      (__FEATURE_SUSPENSE__
        ? ` If you are using async setup(), make sure to register lifecycle ` +
        `hooks before the first await statement.`
        : ``)
    )
  }
}
// 利用函数柯里化手段，固定是什么生命周期，主要是为了提取公共函数
export const createHook = <T extends Function = () => any>(
  lifecycle: LifecycleHooks
) => (hook: T, target: ComponentInternalInstance | null = currentInstance) =>
    // post-create lifecycle registrations are noops during SSR
    !isInSSRComponentSetup && injectHook(lifecycle, hook, target)

export const onBeforeMount = createHook(LifecycleHooks.BEFORE_MOUNT)
export const onMounted = createHook(LifecycleHooks.MOUNTED)
export const onBeforeUpdate = createHook(LifecycleHooks.BEFORE_UPDATE)
export const onUpdated = createHook(LifecycleHooks.UPDATED)
export const onBeforeUnmount = createHook(LifecycleHooks.BEFORE_UNMOUNT)
export const onUnmounted = createHook(LifecycleHooks.UNMOUNTED)

export type DebuggerHook = (e: DebuggerEvent) => void
export const onRenderTriggered = createHook<DebuggerHook>(
  LifecycleHooks.RENDER_TRIGGERED
)
export const onRenderTracked = createHook<DebuggerHook>(
  LifecycleHooks.RENDER_TRACKED
)

export type ErrorCapturedHook = (
  err: unknown,
  instance: ComponentPublicInstance | null,
  info: string
) => boolean | void

export const onErrorCaptured = (
  hook: ErrorCapturedHook,
  target: ComponentInternalInstance | null = currentInstance
) => {
  injectHook(LifecycleHooks.ERROR_CAPTURED, hook, target)
}
