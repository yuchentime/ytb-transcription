import path from 'node:path'
import type { DatabaseContext } from '../db'
import { TaskEngine } from './TaskEngine'

let engine: TaskEngine | null = null

export function initTaskEngine(dbContext: DatabaseContext): TaskEngine {
  if (engine) return engine

  const dataRoot = path.dirname(dbContext.dbPath)
  const artifactsRoot = path.join(dataRoot, 'artifacts')
  engine = new TaskEngine({
    taskDao: dbContext.taskDao,
    taskStepDao: dbContext.taskStepDao,
    artifactDao: dbContext.artifactDao,
    settingsDao: dbContext.settingsDao,
    artifactsRoot,
    dataRoot,
  })

  return engine
}

export function getTaskEngine(): TaskEngine {
  if (!engine) {
    throw new Error('TaskEngine is not initialized. Call initTaskEngine() first.')
  }
  return engine
}
