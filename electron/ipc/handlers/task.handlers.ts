import { BrowserWindow, ipcMain } from 'electron'
import { getDatabaseContext } from '../../core/db'
import { getTaskEngine } from '../../core/task-engine'
import {
  IPC_CHANNELS,
  type TaskDetail,
  type TaskIdPayload
} from '../channels'

let taskEventsSubscribed = false

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

function assertTaskId(payload: TaskIdPayload): string {
  if (!payload?.taskId || typeof payload.taskId !== 'string') {
    throw new Error('taskId is required')
  }
  return payload.taskId
}

export function registerTaskHandlers(): void {
  if (!taskEventsSubscribed) {
    const engine = getTaskEngine()
    engine.on('status', (payload) => broadcast(IPC_CHANNELS.taskStatus, payload))
    engine.on('progress', (payload) => broadcast(IPC_CHANNELS.taskProgress, payload))
    engine.on('log', (payload) => broadcast(IPC_CHANNELS.taskLog, payload))
    engine.on('completed', (payload) => broadcast(IPC_CHANNELS.taskCompleted, payload))
    engine.on('failed', (payload) => broadcast(IPC_CHANNELS.taskFailed, payload))
    engine.on('runtime', (payload) => broadcast(IPC_CHANNELS.taskRuntime, payload))
    taskEventsSubscribed = true
  }

  ipcMain.handle(IPC_CHANNELS.taskCreate, (_event, input) => {
    const { taskDao } = getDatabaseContext()
    const created = taskDao.createTask(input)
    broadcast(IPC_CHANNELS.taskStatus, {
      taskId: created.id,
      status: created.status,
      timestamp: new Date().toISOString(),
    })
    return created
  })

  ipcMain.handle(IPC_CHANNELS.taskGet, (_event, payload: TaskIdPayload): TaskDetail => {
    const taskId = assertTaskId(payload)
    const { taskDao, taskStepDao, artifactDao } = getDatabaseContext()
    return {
      task: taskDao.getTaskById(taskId),
      steps: taskStepDao.listSteps(taskId),
      artifacts: artifactDao.listArtifacts(taskId),
    }
  })

  ipcMain.handle(IPC_CHANNELS.taskStart, (_event, payload: TaskIdPayload) => {
    const taskId = assertTaskId(payload)
    const engine = getTaskEngine()
    return engine.start(taskId)
  })

  ipcMain.handle(IPC_CHANNELS.taskCancel, (_event, payload: TaskIdPayload) => {
    const taskId = assertTaskId(payload)
    const engine = getTaskEngine()
    return engine.cancel(taskId)
  })

  ipcMain.handle(IPC_CHANNELS.taskRetry, (_event, payload: TaskIdPayload) => {
    const taskId = assertTaskId(payload)
    const engine = getTaskEngine()
    return engine.retry(taskId)
  })
}
