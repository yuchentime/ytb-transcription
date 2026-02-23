import path from 'node:path'
import type { DatabaseContext } from '../db'
import { TaskEngine } from './TaskEngine'
import { BatchCreator } from './batch/BatchCreator'
import { QueueRecovery } from './queue/QueueRecovery'
import { QueueScheduler } from './queue/QueueScheduler'
import { QueueStore } from './queue/QueueStore'

let engine: TaskEngine | null = null
let queueScheduler: QueueScheduler | null = null
let batchCreator: BatchCreator | null = null

export function initTaskEngine(dbContext: DatabaseContext): TaskEngine {
  if (engine && queueScheduler && batchCreator) return engine

  const dataRoot = path.dirname(dbContext.dbPath)
  const artifactsRoot = path.join(dataRoot, 'artifacts')
  engine = new TaskEngine({
    taskDao: dbContext.taskDao,
    taskStepDao: dbContext.taskStepDao,
    taskSegmentDao: dbContext.taskSegmentDao,
    taskRecoveryDao: dbContext.taskRecoveryDao,
    artifactDao: dbContext.artifactDao,
    settingsDao: dbContext.settingsDao,
    artifactsRoot,
    dataRoot,
  })
  const taskEngine = engine

  const queueStore = new QueueStore(dbContext.taskQueueDao)
  const preparedResumeTaskIds = new Set<string>()
  const prepareResumeForTask = (taskId: string): void => {
    if (preparedResumeTaskIds.has(taskId)) return
    preparedResumeTaskIds.add(taskId)
    try {
      taskEngine.prepareResumeFromCheckpoint(taskId)
    } catch {
      // Ignore restore-preparation errors and let scheduler retry from queued state.
    }
  }

  const interruptedRunningTasks = queueStore.getSnapshot(false).running.map((task) => task.taskId)
  for (const taskId of interruptedRunningTasks) {
    prepareResumeForTask(taskId)
  }

  queueScheduler = new QueueScheduler({
    taskEngine,
    taskDao: dbContext.taskDao,
    batchDao: dbContext.batchDao,
    queueStore,
    workerConcurrency: 1,
    consecutiveFailureThreshold: 3,
  })

  const queueRecovery = new QueueRecovery({
    queueStore,
    taskDao: dbContext.taskDao,
    batchDao: dbContext.batchDao,
    staleTimeoutMs: 10 * 60 * 1000,
  })
  const recovered = queueRecovery.recoverStaleRunningTasks()
  for (const taskId of recovered.recoveredTaskIds) {
    prepareResumeForTask(taskId)
  }

  queueScheduler.start()

  batchCreator = new BatchCreator({
    taskDao: dbContext.taskDao,
    batchDao: dbContext.batchDao,
    queueScheduler,
  })

  return engine
}

export function getTaskEngine(): TaskEngine {
  if (!engine) {
    throw new Error('TaskEngine is not initialized. Call initTaskEngine() first.')
  }
  return engine
}

export function getQueueScheduler(): QueueScheduler {
  if (!queueScheduler) {
    throw new Error('QueueScheduler is not initialized. Call initTaskEngine() first.')
  }
  return queueScheduler
}

export function getBatchCreator(): BatchCreator {
  if (!batchCreator) {
    throw new Error('BatchCreator is not initialized. Call initTaskEngine() first.')
  }
  return batchCreator
}
