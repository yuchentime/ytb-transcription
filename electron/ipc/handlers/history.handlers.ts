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
    await fs.rmdir(dirPath)
  } catch {
    // Ignore if directory is not empty or inaccessible.
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

      const { taskDao, artifactDao } = getDatabaseContext()
      const artifacts = artifactDao.listArtifacts(payload.taskId)
      const parentDirs = new Set<string>()

      for (const artifact of artifacts) {
        parentDirs.add(path.dirname(artifact.filePath))
        await safeRemoveFile(artifact.filePath)
      }

      const deletedCount = taskDao.deleteTask(payload.taskId)

      for (const dirPath of parentDirs) {
        await safeRemoveEmptyDir(dirPath)
      }

      return { deleted: deletedCount > 0 }
    },
  )
}

