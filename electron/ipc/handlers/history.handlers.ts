import fs from 'node:fs/promises'
import path from 'node:path'
import { ipcMain } from 'electron'
import { getDatabaseContext } from '../../core/db'
import {
  IPC_CHANNELS,
  type HistoryDeleteResult,
  type TaskIdPayload,
} from '../channels'

async function safeRemoveFile(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath, { force: true })
  } catch {
    // Ignore individual file cleanup failures in MVP.
  }
}

async function safeRemoveEmptyDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true })
  } catch {
    // Ignore cleanup failures in MVP.
  }
}

export function registerHistoryHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.historyList, (_event, query) => {
    const { taskDao } = getDatabaseContext()
    return taskDao.listTasks(query ?? {})
  })

  ipcMain.handle(
    IPC_CHANNELS.historyDelete,
    async (_event, payload: TaskIdPayload): Promise<HistoryDeleteResult> => {
      if (!payload?.taskId || typeof payload.taskId !== 'string') {
        throw new Error('taskId is required')
      }

      const { dbPath, taskDao, artifactDao } = getDatabaseContext()
      const artifacts = artifactDao.listArtifacts(payload.taskId)

      for (const artifact of artifacts) {
        await safeRemoveFile(artifact.filePath)
      }

      const deleted = taskDao.deleteTaskCascade(payload.taskId)
      const taskDir = path.join(path.dirname(dbPath), 'artifacts', payload.taskId)
      await safeRemoveEmptyDir(taskDir)

      return { deleted: deleted.taskDeleted }
    },
  )
}
