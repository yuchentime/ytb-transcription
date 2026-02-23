import { EventEmitter } from 'node:events'
import type { BatchDao, TaskDao } from '../../db/dao'
import type { BatchProgress, QueueSnapshot, QueueTaskRecord } from '../../db/types'
import type { TaskEngine } from '../TaskEngine'
import { QueueStore } from './QueueStore'
import { WorkerPool } from './WorkerPool'

export interface QueueUpdatedPayload {
  paused: boolean
  waiting: number
  running: number
  completed: number
  failed: number
  updatedAt: string
}

export interface QueueTaskMovedPayload {
  taskId: string
  fromIndex: number
  toIndex: number
}

export interface BatchCompletedPayload {
  batchId: string
  total: number
  completed: number
  failed: number
}

interface QueueSchedulerEvents {
  queueUpdated: QueueUpdatedPayload
  queueTaskMoved: QueueTaskMovedPayload
  batchProgress: BatchProgress
  batchCompleted: BatchCompletedPayload
}

type QueueSchedulerEventName = keyof QueueSchedulerEvents
type QueueSchedulerListener<T extends QueueSchedulerEventName> = (payload: QueueSchedulerEvents[T]) => void

export class QueueScheduler {
  private readonly emitter = new EventEmitter()
  private readonly workerPool: WorkerPool
  private readonly queueStore: QueueStore
  private paused = false
  private started = false
  private scheduleQueued = false
  private consecutiveFailureCount = 0
  private readonly consecutiveFailureThreshold: number

  constructor(
    private readonly deps: {
      taskEngine: TaskEngine
      taskDao: TaskDao
      batchDao: BatchDao
      queueStore: QueueStore
      workerConcurrency?: number
      consecutiveFailureThreshold?: number
    },
  ) {
    this.workerPool = new WorkerPool(deps.workerConcurrency ?? 1)
    this.queueStore = deps.queueStore
    this.consecutiveFailureThreshold = Math.max(1, deps.consecutiveFailureThreshold ?? 3)
  }

  on<T extends QueueSchedulerEventName>(event: T, listener: QueueSchedulerListener<T>): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return () => {
      this.emitter.off(event, listener as (...args: unknown[]) => void)
    }
  }

  start(): void {
    if (this.started) return
    this.started = true

    this.deps.taskEngine.on('completed', (payload) => {
      this.handleTaskTerminated(payload.taskId, 'completed')
    })

    this.deps.taskEngine.on('failed', (payload) => {
      this.handleTaskTerminated(payload.taskId, 'failed', payload.errorCode)
    })

    this.deps.taskEngine.on('status', (payload) => {
      if (payload.status === 'canceled') {
        this.handleTaskTerminated(payload.taskId, 'failed', 'E_TASK_CANCELED', {
          countAsFailure: false,
        })
      } else if (payload.status === 'failed') {
        this.handleTaskTerminated(payload.taskId, 'failed', 'E_TASK_FAILED')
      }
    })

    this.emitQueueUpdated()
    this.schedule()
  }

  pause(): { paused: boolean } {
    this.paused = true
    this.emitQueueUpdated()
    return { paused: true }
  }

  resume(): { resumed: boolean } {
    this.paused = false
    this.emitQueueUpdated()
    this.schedule()
    return { resumed: true }
  }

  isPaused(): boolean {
    return this.paused
  }

  getSnapshot(): QueueSnapshot {
    this.reconcileRunningState()
    return this.queueStore.getSnapshot(this.paused)
  }

  enqueueTask(taskId: string, batchId?: string | null, priority = 0): QueueTaskRecord {
    const queueTask = this.queueStore.enqueue(taskId, batchId, priority)
    this.deps.taskDao.updateTaskStatus(taskId, 'queued', {
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    })

    if (batchId) {
      this.emitBatchProgress(batchId)
    }

    this.emitQueueUpdated()
    this.schedule()
    return queueTask
  }

  requeueTask(taskId: string): { accepted: boolean; reason?: string } {
    let queueRecord: QueueTaskRecord | null = null
    try {
      queueRecord = this.queueStore.getByTaskId(taskId)
    } catch {
      queueRecord = null
    }

    if (!queueRecord) {
      this.enqueueTask(taskId, null, 0)
      return { accepted: true }
    }

    if (queueRecord.queueStatus === 'running') {
      return { accepted: false, reason: `Task ${taskId} is already running` }
    }

    if (queueRecord.queueStatus !== 'waiting') {
      queueRecord = this.queueStore.moveToWaitingTail(taskId)
    }

    this.deps.taskDao.updateTaskStatus(taskId, 'queued', {
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    })

    if (queueRecord.batchId) {
      try {
        this.deps.batchDao.updateBatchItemStatusByTaskId(taskId, 'queued')
        this.emitBatchProgress(queueRecord.batchId)
      } catch {
        // Ignore non-batch tasks.
      }
    }

    this.emitQueueUpdated()
    this.schedule()
    return { accepted: true }
  }

  reorder(taskId: string, toIndex: number): { ok: boolean; fromIndex?: number; toIndex?: number } {
    const moved = this.queueStore.reorder(taskId, toIndex)
    this.emitter.emit('queueTaskMoved', {
      taskId,
      fromIndex: moved.fromIndex,
      toIndex: moved.toIndex,
    } satisfies QueueTaskMovedPayload)
    this.emitQueueUpdated()

    return {
      ok: true,
      fromIndex: moved.fromIndex,
      toIndex: moved.toIndex,
    }
  }

  removeWaitingTask(taskId: string): { removed: boolean } {
    let queueRecord: QueueTaskRecord | null = null
    try {
      queueRecord = this.queueStore.getByTaskId(taskId)
    } catch {
      queueRecord = null
    }

    if (!queueRecord || queueRecord.queueStatus !== 'waiting') {
      return { removed: false }
    }

    const removed = this.queueStore.removeWaitingTask(taskId)
    if (!removed) {
      return { removed: false }
    }

    this.deps.taskDao.updateTaskStatus(taskId, 'canceled', {
      errorCode: 'E_QUEUE_REMOVED',
      errorMessage: 'Removed from waiting queue',
      completedAt: new Date().toISOString(),
    })

    if (queueRecord.batchId) {
      try {
        this.deps.batchDao.updateBatchItemStatusByTaskId(taskId, 'failed', {
          rejectReason: 'Removed from waiting queue',
        })
        this.emitBatchProgress(queueRecord.batchId)
      } catch {
        // Ignore non-batch tasks.
      }
    }

    this.emitQueueUpdated()
    return { removed: true }
  }

  private handleTaskTerminated(
    taskId: string,
    status: 'completed' | 'failed',
    errorCode?: string,
    options?: {
      countAsFailure?: boolean
    },
  ): void {
    let queueRecord: QueueTaskRecord
    try {
      queueRecord = this.queueStore.getByTaskId(taskId)
    } catch {
      return
    }

    if (queueRecord.queueStatus !== 'running') {
      return
    }

    this.workerPool.releaseByTask(taskId)
    const finishedRecord = this.queueStore.markFinished(taskId, status, errorCode)

    const countAsFailure = options?.countAsFailure ?? status === 'failed'

    if (status === 'failed' && countAsFailure) {
      this.consecutiveFailureCount += 1
      if (this.consecutiveFailureCount >= this.consecutiveFailureThreshold) {
        this.paused = true
      }
    } else {
      this.consecutiveFailureCount = 0
    }

    if (finishedRecord.batchId) {
      const batchItemStatus = status === 'completed' ? 'completed' : 'failed'
      try {
        this.deps.batchDao.updateBatchItemStatusByTaskId(taskId, batchItemStatus, {
          rejectReason: status === 'failed' ? errorCode ?? 'Task failed' : null,
        })
        this.emitBatchProgress(finishedRecord.batchId)
      } catch {
        // Ignore non-batch tasks.
      }
    }

    this.emitQueueUpdated()
    this.schedule()
  }

  private schedule(): void {
    if (!this.started || this.paused || this.scheduleQueued) {
      return
    }

    this.scheduleQueued = true
    queueMicrotask(() => {
      this.scheduleQueued = false
      this.dispatchTasks()
    })
  }

  private dispatchTasks(): void {
    if (this.paused) {
      this.emitQueueUpdated()
      return
    }

    while (this.workerPool.hasCapacity()) {
      const next = this.queueStore.dequeue(1)[0]
      if (!next) {
        break
      }

      const slot = this.workerPool.acquire(next.taskId)
      if (slot === null) {
        break
      }

      this.queueStore.markRunning(next.taskId, slot)
      if (next.batchId) {
        try {
          this.deps.batchDao.updateBatchItemStatusByTaskId(next.taskId, 'running')
          this.emitBatchProgress(next.batchId)
        } catch {
          // Ignore non-batch tasks.
        }
      }

      const result = this.deps.taskEngine.start(next.taskId)
      if (result.accepted) {
        continue
      }

      this.workerPool.releaseByTask(next.taskId)
      this.queueStore.requeueTasks([next.taskId])
      if (next.batchId) {
        try {
          this.deps.batchDao.updateBatchItemStatusByTaskId(next.taskId, 'queued')
          this.emitBatchProgress(next.batchId)
        } catch {
          // Ignore non-batch tasks.
        }
      }

      if (result.reason?.includes('already running')) {
        this.scheduleAfterDelay(200)
        break
      }

      this.queueStore.markFinished(next.taskId, 'failed', 'E_QUEUE_START_REJECTED')
      this.deps.taskDao.updateTaskStatus(next.taskId, 'failed', {
        errorCode: 'E_QUEUE_START_REJECTED',
        errorMessage: result.reason ?? 'Queue start rejected',
        completedAt: new Date().toISOString(),
      })

      if (next.batchId) {
        try {
          this.deps.batchDao.updateBatchItemStatusByTaskId(next.taskId, 'failed', {
            rejectReason: result.reason ?? 'Queue start rejected',
          })
          this.emitBatchProgress(next.batchId)
        } catch {
          // Ignore non-batch tasks.
        }
      }
    }

    this.emitQueueUpdated()
  }

  private emitQueueUpdated(): void {
    const snapshot = this.getSnapshot()
    this.emitter.emit('queueUpdated', {
      paused: snapshot.paused,
      waiting: snapshot.waiting.length,
      running: snapshot.running.length,
      completed: snapshot.completed.length,
      failed: snapshot.failed.length,
      updatedAt: snapshot.updatedAt,
    } satisfies QueueUpdatedPayload)
  }

  private reconcileRunningState(): void {
    const snapshot = this.queueStore.getSnapshot(this.paused)
    const running = snapshot.running
    if (running.length === 0) {
      return
    }

    const maxRunning = this.workerPool.capacity()
    const expectedRunningTaskIds = new Set<string>()
    for (const taskId of this.workerPool.runningTaskIds()) {
      expectedRunningTaskIds.add(taskId)
    }

    const engineRunningTaskId = this.deps.taskEngine.getRunningTaskId()
    if (engineRunningTaskId) {
      expectedRunningTaskIds.add(engineRunningTaskId)
    }

    let overflow: QueueTaskRecord[] = []
    if (expectedRunningTaskIds.size === 0) {
      overflow = running
    } else {
      const keep = new Set<string>()
      const runningTaskIds = new Set(running.map((task) => task.taskId))

      if (engineRunningTaskId && runningTaskIds.has(engineRunningTaskId)) {
        keep.add(engineRunningTaskId)
      }

      for (const taskId of this.workerPool.runningTaskIds()) {
        if (keep.size >= maxRunning) break
        if (runningTaskIds.has(taskId)) {
          keep.add(taskId)
        }
      }

      if (keep.size === 0) {
        for (const task of running) {
          if (keep.size >= maxRunning) break
          if (expectedRunningTaskIds.has(task.taskId)) {
            keep.add(task.taskId)
          }
        }
      }
      overflow = running.filter((task) => !keep.has(task.taskId))
    }

    if (overflow.length === 0) {
      return
    }

    const overflowTaskIds = overflow.map((task) => task.taskId)
    this.queueStore.requeueTasks(overflowTaskIds)
    for (const task of overflow) {
      this.workerPool.releaseByTask(task.taskId)
      this.deps.taskDao.updateTaskStatus(task.taskId, 'queued', {
        errorCode: null,
        errorMessage: null,
        completedAt: null,
      })

      if (task.batchId) {
        try {
          this.deps.batchDao.updateBatchItemStatusByTaskId(task.taskId, 'queued')
          this.emitBatchProgress(task.batchId)
        } catch {
          // Ignore non-batch tasks.
        }
      }
    }
  }

  private emitBatchProgress(batchId: string): void {
    const progress = this.deps.batchDao.getBatchProgress(batchId)
    this.emitter.emit('batchProgress', progress)

    if (progress.total > 0 && progress.completed + progress.failed >= progress.total) {
      this.emitter.emit('batchCompleted', {
        batchId,
        total: progress.total,
        completed: progress.completed,
        failed: progress.failed,
      } satisfies BatchCompletedPayload)
    }
  }

  private scheduleAfterDelay(delayMs: number): void {
    setTimeout(() => {
      this.schedule()
    }, Math.max(0, Math.floor(delayMs)))
  }
}
