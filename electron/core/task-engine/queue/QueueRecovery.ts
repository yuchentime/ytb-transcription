import type { BatchDao, TaskDao } from '../../db/dao'
import { QueueStore } from './QueueStore'

export class QueueRecovery {
  constructor(
    private readonly deps: {
      queueStore: QueueStore
      taskDao: TaskDao
      batchDao: BatchDao
      staleTimeoutMs?: number
    },
  ) {}

  recoverStaleRunningTasks(): { recoveredTaskIds: string[] } {
    const staleTimeoutMs = this.deps.staleTimeoutMs ?? 5 * 60 * 1000
    const staleTasks = this.deps.queueStore.listStaleRunningTasks(staleTimeoutMs)
    if (staleTasks.length === 0) {
      return { recoveredTaskIds: [] }
    }

    const recoveredTaskIds = staleTasks.map((task) => task.taskId)
    this.deps.queueStore.requeueTasks(recoveredTaskIds)

    for (const task of staleTasks) {
      this.deps.taskDao.updateTaskStatus(task.taskId, 'queued', {
        errorCode: null,
        errorMessage: null,
        completedAt: null,
      })

      try {
        this.deps.batchDao.updateBatchItemStatusByTaskId(task.taskId, 'queued')
      } catch {
        // Ignore if task does not belong to a batch.
      }
    }

    return { recoveredTaskIds }
  }
}
