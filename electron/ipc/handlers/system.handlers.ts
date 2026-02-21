import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, ipcMain, shell } from 'electron'
import type { AppSettings } from '../../core/db/types'
import { getDatabaseContext } from '../../core/db'
import {
  IPC_CHANNELS,
  type ExportDiagnosticsPayload,
  type ExportDiagnosticsResult,
  type OpenPathPayload,
  type OpenPathResult,
} from '../channels'

function assertPathInput(payload: OpenPathPayload): string {
  if (!payload?.path || typeof payload.path !== 'string') {
    throw new Error('path is required')
  }
  return path.resolve(payload.path)
}

function maskSecret(secret: string): string {
  if (!secret) return ''
  if (secret.length <= 8) return '********'
  return `${secret.slice(0, 3)}***${secret.slice(-3)}`
}

function sanitizeSettings(settings: AppSettings): Omit<AppSettings, 'minimaxApiKey'> & { minimaxApiKey: string } {
  return {
    ...settings,
    minimaxApiKey: maskSecret(settings.minimaxApiKey),
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

export function registerSystemHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.systemOpenPath,
    async (_event, payload: OpenPathPayload): Promise<OpenPathResult> => {
      const targetPath = assertPathInput(payload)
      const stat = await fs.stat(targetPath).catch(() => null)
      if (!stat) {
        throw new Error(`Path does not exist: ${targetPath}`)
      }

      if (stat.isDirectory()) {
        const result = await shell.openPath(targetPath)
        if (result) {
          throw new Error(result)
        }
      } else {
        shell.showItemInFolder(targetPath)
      }

      return { ok: true }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.systemExportDiagnostics,
    async (
      _event,
      payload: ExportDiagnosticsPayload = {},
    ): Promise<ExportDiagnosticsResult> => {
      if (payload.taskId !== undefined && typeof payload.taskId !== 'string') {
        throw new Error('taskId must be a string when provided')
      }

      const { dbPath, taskDao, taskStepDao, artifactDao, settingsDao } = getDatabaseContext()
      const dataRoot = path.dirname(dbPath)
      const diagnosticsDir = path.join(dataRoot, 'diagnostics')
      await fs.mkdir(diagnosticsDir, { recursive: true })

      const latest = taskDao.listTasks({ page: 1, pageSize: 20 })
      const report: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        hostname: os.hostname(),
        dataRoot,
        dbPath,
        settings: sanitizeSettings(settingsDao.getSettings()),
        summary: {
          latestTotal: latest.total,
          pageSize: latest.pageSize,
          tasks: latest.items.map((item) => ({
            id: item.id,
            status: item.status,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            targetLanguage: item.targetLanguage,
            errorCode: item.errorCode,
          })),
        },
      }

      if (payload.taskId) {
        const task = taskDao.getTaskById(payload.taskId)
        const steps = taskStepDao.listSteps(payload.taskId)
        const artifacts = artifactDao.listArtifacts(payload.taskId)
        const artifactsWithExists = await Promise.all(
          artifacts.map(async (artifact) => ({
            ...artifact,
            exists: await fileExists(artifact.filePath),
          })),
        )
        report.taskDetail = {
          task,
          steps,
          artifacts: artifactsWithExists,
        }
      }

      const timestamp = new Date().toISOString().replace(/[.:]/g, '-')
      const fileName = payload.taskId
        ? `diagnostics-${payload.taskId}-${timestamp}.json`
        : `diagnostics-${timestamp}.json`
      const filePath = path.join(diagnosticsDir, fileName)

      await fs.writeFile(filePath, JSON.stringify(report, null, 2), 'utf-8')
      return { filePath }
    },
  )
}

