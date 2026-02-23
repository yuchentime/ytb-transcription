import type { TaskQueueDao } from '../../db/dao'
import type { QueueSnapshot, QueueTaskRecord, QueueStatus } from '../../db/types'

export class QueueStore {
  constructor(private readonly taskQueueDao: TaskQueueDao) {}

  enqueue(taskId: string, batchId?: string | null, priority = 0): QueueTaskRecord {
    return this.taskQueueDao.enqueue(taskId, batchId, priority)
  }

  dequeue(limit: number): QueueTaskRecord[] {
    return this.taskQueueDao.dequeueNext(limit)
  }

  markRunning(taskId: string, workerSlot: number): QueueTaskRecord {
    return this.taskQueueDao.updateQueueStatus(taskId, 'running', {
      workerSlot,
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    })
  }

  markFinished(taskId: string, status: Extract<QueueStatus, 'completed' | 'failed'>, lastErrorCode?: string): QueueTaskRecord {
    return this.taskQueueDao.updateQueueStatus(taskId, status, {
      lastErrorCode: lastErrorCode ?? null,
      finishedAt: new Date().toISOString(),
      workerSlot: null,
      heartbeatAt: null,
    })
  }

  reorder(taskId: string, toIndex: number): { fromIndex: number; toIndex: number } {
    return this.taskQueueDao.reorder(taskId, toIndex)
  }

  removeWaitingTask(taskId: string): boolean {
    return this.taskQueueDao.removeWaitingTask(taskId)
  }

  getByTaskId(taskId: string): QueueTaskRecord {
    return this.taskQueueDao.getByTaskId(taskId)
  }

  getSnapshot(paused: boolean): QueueSnapshot {
    const snapshot = this.taskQueueDao.getSnapshot()
    return {
      ...snapshot,
      paused,
      updatedAt: new Date().toISOString(),
    }
  }

  listStaleRunningTasks(timeoutMs: number): QueueTaskRecord[] {
    return this.taskQueueDao.listStaleRunningTasks(timeoutMs)
  }

  requeueTasks(taskIds: string[]): number {
    return this.taskQueueDao.requeueTasks(taskIds)
  }

  moveToWaitingTail(taskId: string): QueueTaskRecord {
    return this.taskQueueDao.moveToWaitingTail(taskId)
  }
}
