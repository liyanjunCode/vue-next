import { ErrorCodes, callWithErrorHandling } from './errorHandling'
import { isArray } from '@vue/shared'
import { ComponentPublicInstance } from './componentPublicInstance'

export interface SchedulerJob {
  (): void
  /**
   * unique job id, only present on raw effects, e.g. component render effect
   */
  id?: number
  /**
   * Indicates whether the job is allowed to recursively trigger itself.
   * By default, a job cannot trigger itself because some built-in method calls,
   * e.g. Array.prototype.push actually performs reads as well (#1740) which
   * can lead to confusing infinite loops.
   * The allowed cases are component update functions and watch callbacks.
   * Component update functions may update child component props, which in turn
   * trigger flush: "pre" watch callbacks that mutates state that the parent
   * relies on (#1801). Watch callbacks doesn't track its dependencies so if it
   * triggers itself again, it's likely intentional and it is the user's
   * responsibility to perform recursive state mutation that eventually
   * stabilizes (#1727).
   */
  allowRecurse?: boolean
}

export type SchedulerCb = Function & { id?: number }
export type SchedulerCbs = SchedulerCb | SchedulerCb[]
// 异步任务队列是否正在执行 
let isFlushing = false
// 异步任务队列是否等待执行 
let isFlushPending = false

const queue: SchedulerJob[] = []
let flushIndex = 0
// 异步任务队列 任务执行前执行的回调函数队列 
const pendingPreFlushCbs: SchedulerCb[] = []
let activePreFlushCbs: SchedulerCb[] | null = null
let preFlushIndex = 0
// 异步任务队列 任务执行完后执行的回调函数队列 
const pendingPostFlushCbs: SchedulerCb[] = []
let activePostFlushCbs: SchedulerCb[] | null = null
let postFlushIndex = 0

const resolvedPromise: Promise<any> = Promise.resolve()
let currentFlushPromise: Promise<void> | null = null

let currentPreFlushParentJob: SchedulerJob | null = null

const RECURSION_LIMIT = 100
type CountMap = Map<SchedulerJob | SchedulerCb, number>

export function nextTick(
  this: ComponentPublicInstance | void,
  fn?: () => void
): Promise<void> {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(this ? fn.bind(this) : fn) : p
}
// 将任务队列添加到任务队列数组最后
export function queueJob(job: SchedulerJob) {
  // the dedupe search uses the startIndex argument of Array.includes()
  // by default the search index includes the current job that is being run
  // so it cannot recursively trigger itself again.
  // if the job is a watch() callback, the search will start with a +1 index to
  // allow it recursively trigger itself - it is the user's responsibility to
  // ensure it doesn't end up in an infinite loop.
  if (
    (!queue.length ||
      !queue.includes(
        job,
        isFlushing && job.allowRecurse ? flushIndex + 1 : flushIndex
      )) &&
    job !== currentPreFlushParentJob
  ) {
    queue.push(job)
    queueFlush()
  }
}
// 在 queueFlush 首次执行时，isFlushing 和 isFlushPending 都是 false，此时会把 
// isFlushPending 设置为 true。
function queueFlush() {
  if (!isFlushing && !isFlushPending) {
    isFlushPending = true
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}

export function invalidateJob(job: SchedulerJob) {
  const i = queue.indexOf(job)
  if (i > -1) {
    queue.splice(i, 1)
  }
}

function queueCb(
  cb: SchedulerCbs,
  activeQueue: SchedulerCb[] | null,
  pendingQueue: SchedulerCb[],
  index: number
) {
  if (!isArray(cb)) {
    if (
      !activeQueue ||
      !activeQueue.includes(
        cb,
        (cb as SchedulerJob).allowRecurse ? index + 1 : index
      )
    ) {
      pendingQueue.push(cb)
    }
  } else {
    // if cb is an array, it is a component lifecycle hook which can only be
    // triggered by a job, which is already deduped in the main queue, so
    // we can skip duplicate check here to improve perf
    // 如果是数组，把它拍平成一维 
    pendingQueue.push(...cb)
  }
  queueFlush()
}

export function queuePreFlushCb(cb: SchedulerCb) {
  queueCb(cb, activePreFlushCbs, pendingPreFlushCbs, preFlushIndex)
}
// 将异步队列回掉函数添加到postFlushCbs 中
export function queuePostFlushCb(cb: SchedulerCbs) {
  queueCb(cb, activePostFlushCbs, pendingPostFlushCbs, postFlushIndex)
}

export function flushPreFlushCbs(
  seen?: CountMap,
  parentJob: SchedulerJob | null = null
) {
  if (pendingPreFlushCbs.length) {
    currentPreFlushParentJob = parentJob
    activePreFlushCbs = [...new Set(pendingPreFlushCbs)]
    pendingPreFlushCbs.length = 0
    if (__DEV__) {
      seen = seen || new Map()
    }
    for (
      preFlushIndex = 0;
      preFlushIndex < activePreFlushCbs.length;
      preFlushIndex++
    ) {
      if (__DEV__) {
        checkRecursiveUpdates(seen!, activePreFlushCbs[preFlushIndex])
      }
      activePreFlushCbs[preFlushIndex]()
    }
    activePreFlushCbs = null
    preFlushIndex = 0
    currentPreFlushParentJob = null
    // recursively flush until it drains
    flushPreFlushCbs(seen, parentJob)
  }
}

export function flushPostFlushCbs(seen?: CountMap) {
  if (pendingPostFlushCbs.length) {
    const deduped = [...new Set(pendingPostFlushCbs)]
    pendingPostFlushCbs.length = 0

    // #1947 already has active queue, nested flushPostFlushCbs call
    if (activePostFlushCbs) {
      activePostFlushCbs.push(...deduped)
      return
    }

    activePostFlushCbs = deduped
    if (__DEV__) {
      seen = seen || new Map()
    }

    activePostFlushCbs.sort((a, b) => getId(a) - getId(b))

    for (
      postFlushIndex = 0;
      postFlushIndex < activePostFlushCbs.length;
      postFlushIndex++
    ) {
      if (__DEV__) {
        checkRecursiveUpdates(seen!, activePostFlushCbs[postFlushIndex])
      }
      activePostFlushCbs[postFlushIndex]()
    }
    activePostFlushCbs = null
    postFlushIndex = 0
  }
}

const getId = (job: SchedulerJob | SchedulerCb) =>
  job.id == null ? Infinity : job.id

function flushJobs(seen?: CountMap) {
  // 把 isFlushPending 重置为 false，把 isFlushing 设置为 true 来表示正在执行异步任务队列。
  isFlushPending = false
  isFlushing = true
  if (__DEV__) {
    seen = seen || new Map()
  }

  flushPreFlushCbs(seen)

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child so its render effect will have smaller
  //    priority number)
  // 2. If a component is unmounted during a parent component's update,
  //    its update can be skipped.
  // Jobs can never be null before flush starts, since they are only invalidated
  // during execution of another flushed job.
  // 组件的更新是先父后子 
  // 如果一个组件在父组件更新过程中卸载，它自身的更新应该被跳过 
  // 1.我们创建组件的过程是由父到子，所以创建组件副作用渲染函数也是先父后子，
  // 父组件的副作用渲染函数的 effect id 是小于子组件的
  // 所以为了保证先更新父组再更新子组件，要对 queue 做从小到大的排序
  // 2.如果一个组件在父组件更新过程中被卸载，它自身的更新应该被跳过。
  // 所以也应该要保证先更新父组件再更新子组件，要对 queue 做从小到大的排序
  queue.sort((a, b) => getId(a) - getId(b))

  try {
    // 执行
    for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex]
      if (job) {
        if (__DEV__) {
          checkRecursiveUpdates(seen!, job)
        }
        callWithErrorHandling(job, null, ErrorCodes.SCHEDULER)
      }
    }
  } finally {
    flushIndex = 0
    queue.length = 0
    // 遍历完 queue 后，又会进一步执行 flushPostFlushCbs 
    // 方法去遍历执行所有推入到 postFlushCbs 的回调函数
    flushPostFlushCbs(seen)
    // 遍历完 postFlushCbs 后，会重置 isFlushing 为 false，因为一些 postFlushCb 
    // 执行过程中可能会再次添加异步任务，所以需要继续判断如果 queue 或者 postFlushCbs 队列中还存在任务，
    // 则递归执行 flushJobs 把它们都执行完毕。
    isFlushing = false
    currentFlushPromise = null
    // some postFlushCb queued jobs!
    // keep flushing until it drains.
    // 一些 postFlushCb 执行过程中会再次添加异步任务，递归 flushJobs 会把它们都执行完毕
    if (queue.length || pendingPostFlushCbs.length) {
      flushJobs(seen)
    }
  }
}
// 我们知道 flushJobs 一开始便创建了 seen，它是一个 Map 对象，
// 然后在 checkRecursiveUpdates 的时候会把任务添加到 seen 中，记录引用计数 count，初始值为 1，
// 如果 postFlushCbs 再次添加了相同的任务，则引用计数 count 加 1，如果 count 大于我们定义的限制 100 ，
// 则说明一直在添加这个相同的任务并超过了 100 次。那么，Vue.js 会抛出这个错误，因为在正常的使用中，
// 不应该出现这种情况，而我们上述的错误示例就会触发这种报错逻辑。
function checkRecursiveUpdates(seen: CountMap, fn: SchedulerJob | SchedulerCb) {
  if (!seen.has(fn)) {
    seen.set(fn, 1)
  } else {
    const count = seen.get(fn)!
    if (count > RECURSION_LIMIT) {
      throw new Error(
        `Maximum recursive updates exceeded. ` +
        `This means you have a reactive effect that is mutating its own ` +
        `dependencies and thus recursively triggering itself. Possible sources ` +
        `include component template, render function, updated hook or ` +
        `watcher source function.`
      )
    } else {
      seen.set(fn, count + 1)
    }
  }
}
