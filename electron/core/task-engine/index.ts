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

  const queueStore = new QueueStore(dbContext.taskQueueDao)
  queueScheduler = new QueueScheduler({
    taskEngine: engine,
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
  queueRecovery.recoverStaleRunningTasks()

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
