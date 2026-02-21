import { ipcMain } from 'electron'
import { getDatabaseContext } from '../../core/db'
import { getTaskEngine } from '../../core/task-engine'
import {
  IPC_CHANNELS,
  type RetrySegmentsPayload,
  type TaskIdPayload,
} from '../channels'

function assertTaskId(payload: TaskIdPayload): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload is required')
  }
  if (typeof payload.taskId !== 'string') {
    throw new Error('taskId is required')
  }
  const taskId = payload.taskId.trim()
  if (!taskId) {
    throw new Error('taskId cannot be empty')
  }
  return taskId
}

function assertRetrySegmentPayload(payload: RetrySegmentsPayload): { taskId: string; segmentIds: string[] } {
  const taskId = assertTaskId(payload)
  if (!Array.isArray(payload.segmentIds)) {
    throw new Error('segmentIds must be an array')
  }
  if (payload.segmentIds.length === 0) {
    throw new Error('segmentIds cannot be empty')
  }

  const dedup = new Set<string>()
  const segmentIds: string[] = []
  for (const segmentId of payload.segmentIds) {
    if (typeof segmentId !== 'string') {
      throw new Error('segmentIds must contain only string values')
    }
    const normalized = segmentId.trim()
    if (!normalized) {
      throw new Error('segmentIds cannot contain empty values')
    }
    if (dedup.has(normalized)) continue
    dedup.add(normalized)
    segmentIds.push(normalized)
  }

  if (segmentIds.length === 0) {
    throw new Error('segmentIds cannot be empty')
  }

  return {
    taskId,
    segmentIds,
  }
}

export function registerTaskRecoveryHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.taskSegments, (_event, payload: TaskIdPayload) => {
    const taskId = assertTaskId(payload)
    const { taskSegmentDao } = getDatabaseContext()
    return taskSegmentDao.listByTask(taskId)
  })

  ipcMain.handle(IPC_CHANNELS.taskRetrySegments, (_event, payload: RetrySegmentsPayload) => {
    const { taskId, segmentIds } = assertRetrySegmentPayload(payload)
    const engine = getTaskEngine()
    return engine.retrySegments(taskId, segmentIds)
  })

  ipcMain.handle(IPC_CHANNELS.taskResumeFromCheckpoint, (_event, payload: TaskIdPayload) => {
    const taskId = assertTaskId(payload)
    const engine = getTaskEngine()
    return engine.resumeFromCheckpoint(taskId)
  })

  ipcMain.handle(IPC_CHANNELS.taskRecoveryPlan, (_event, payload: TaskIdPayload) => {
    const taskId = assertTaskId(payload)
    const engine = getTaskEngine()
    return engine.getRecoveryPlan(taskId)
  })
}
