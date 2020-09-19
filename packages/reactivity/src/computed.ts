import { effect, ReactiveEffect, trigger, track } from './effect'
import { TriggerOpTypes, TrackOpTypes } from './operations'
import { Ref } from './ref'
import { isFunction, NOOP } from '@vue/shared'
import { ReactiveFlags, toRaw } from './reactive'

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (ctx?: any) => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

class ComputedRefImpl<T> {
  private _value!: T
  private _dirty = true

  public readonly effect: ReactiveEffect<T>

  public readonly __v_isRef = true;
  public readonly [ReactiveFlags.IS_READONLY]: boolean

  constructor(
    getter: ComputedGetter<T>,
    private readonly _setter: ComputedSetter<T>,
    isReadonly: boolean
  ) {
    this.effect = effect(getter, {
      lazy: true, // 标识是计算属性
      scheduler: () => {
        // 数据是否脏的 ， 标识是否重新计算
        if (!this._dirty) {
          this._dirty = true
          // 通知收集了计算属性的地方都重新渲染，渲染时取最新值
          trigger(toRaw(this), TriggerOpTypes.SET, 'value')
        }
      }
    })

    this[ReactiveFlags.IS_READONLY] = isReadonly
  }

  get value() {
    // 计算属性的 getter 
    if (this._dirty) {
      this._value = this.effect()
      this._dirty = false
    }
    // 依赖收集，收集运行访问该计算属性的 activeEffect 
    track(toRaw(this), TrackOpTypes.GET, 'value')
    return this._value
  }

  set value(newValue: T) {
    // 计算属性的 setter 
    this._setter(newValue)
  }
}

export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
        console.warn('Write operation failed: computed value is readonly')
      }
      : NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  return new ComputedRefImpl(
    getter,
    setter,
    isFunction(getterOrOptions) || !getterOrOptions.set
  ) as any
}
