import { BrowserWindow, ipcMain } from 'electron'
import { getQueueScheduler } from '../../core/task-engine'
import {
  IPC_CHANNELS,
  type QueueRemovePayload,
  type QueueReorderPayload,
} from '../channels'

let queueEventsSubscribed = false

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

function assertQueueReorderPayload(payload: QueueReorderPayload): QueueReorderPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload is required')
  }

  if (typeof payload.taskId !== 'string' || payload.taskId.trim().length === 0) {
    throw new Error('taskId is required')
  }

  if (!Number.isFinite(payload.toIndex)) {
    throw new Error('toIndex must be a number')
  }

  return {
    taskId: payload.taskId.trim(),
    toIndex: Math.max(0, Math.floor(payload.toIndex)),
  }
}

function assertQueueRemovePayload(payload: QueueRemovePayload): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload is required')
  }

  if (typeof payload.taskId !== 'string' || payload.taskId.trim().length === 0) {
    throw new Error('taskId is required')
  }

  return payload.taskId.trim()
}

export function registerQueueHandlers(): void {
  const scheduler = getQueueScheduler()

  if (!queueEventsSubscribed) {
    scheduler.on('queueUpdated', (payload) => broadcast(IPC_CHANNELS.queueUpdated, payload))
    scheduler.on('queueTaskMoved', (payload) => broadcast(IPC_CHANNELS.queueTaskMoved, payload))
    scheduler.on('batchProgress', (payload) => broadcast(IPC_CHANNELS.batchProgress, payload))
    scheduler.on('batchCompleted', (payload) => broadcast(IPC_CHANNELS.batchCompleted, payload))
    queueEventsSubscribed = true
  }

  ipcMain.handle(IPC_CHANNELS.queueList, () => {
    return scheduler.getSnapshot()
  })

  ipcMain.handle(IPC_CHANNELS.queuePause, () => {
    return scheduler.pause()
  })

  ipcMain.handle(IPC_CHANNELS.queueResume, () => {
    return scheduler.resume()
  })

  ipcMain.handle(IPC_CHANNELS.queueReorder, (_event, payload: QueueReorderPayload) => {
    const validPayload = assertQueueReorderPayload(payload)
    const result = scheduler.reorder(validPayload.taskId, validPayload.toIndex)
    return { ok: result.ok }
  })

  ipcMain.handle(IPC_CHANNELS.queueRemove, (_event, payload: QueueRemovePayload) => {
    const taskId = assertQueueRemovePayload(payload)
    return scheduler.removeWaitingTask(taskId)
  })
}
