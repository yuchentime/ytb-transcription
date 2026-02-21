import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, ipcMain, shell } from 'electron'
import type { AppSettings, TaskSegmentRecord } from '../../core/db/types'
import { getDatabaseContext } from '../../core/db'
import { getTaskEngine } from '../../core/task-engine'
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

function safePercentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Number(((numerator / denominator) * 100).toFixed(2))
}

function summarizeSegmentFailures(segments: TaskSegmentRecord[]): {
  failedSegments: number
  byStage: Array<{
    stageName: string
    failedCount: number
    retryableLikelyCount: number
  }>
  byErrorCode: Array<{
    errorCode: string
    count: number
    stageNames: string[]
    sampleMessages: string[]
  }>
} {
  const failed = segments.filter((segment) => segment.status === 'failed')
  const byStageMap = new Map<
    string,
    {
      stageName: string
      failedCount: number
      retryableLikelyCount: number
    }
  >()
  const byErrorCodeMap = new Map<
    string,
    {
      errorCode: string
      count: number
      stageNames: Set<string>
      sampleMessages: Set<string>
    }
  >()

  for (const segment of failed) {
    const stageEntry = byStageMap.get(segment.stageName) ?? {
      stageName: segment.stageName,
      failedCount: 0,
      retryableLikelyCount: 0,
    }
    stageEntry.failedCount += 1
    const normalized = `${segment.errorCode ?? ''} ${segment.errorMessage ?? ''}`.toLowerCase()
    if (
      normalized.includes('timeout') ||
      normalized.includes('network') ||
      normalized.includes('429') ||
      normalized.includes('rate')
    ) {
      stageEntry.retryableLikelyCount += 1
    }
    byStageMap.set(segment.stageName, stageEntry)

    const errorCode = segment.errorCode ?? 'UNKNOWN'
    const errorEntry = byErrorCodeMap.get(errorCode) ?? {
      errorCode,
      count: 0,
      stageNames: new Set<string>(),
      sampleMessages: new Set<string>(),
    }
    errorEntry.count += 1
    errorEntry.stageNames.add(segment.stageName)
    if (segment.errorMessage) {
      errorEntry.sampleMessages.add(segment.errorMessage)
    }
    byErrorCodeMap.set(errorCode, errorEntry)
  }

  return {
    failedSegments: failed.length,
    byStage: Array.from(byStageMap.values()).sort((a, b) => b.failedCount - a.failedCount),
    byErrorCode: Array.from(byErrorCodeMap.values())
      .map((entry) => ({
        errorCode: entry.errorCode,
        count: entry.count,
        stageNames: Array.from(entry.stageNames.values()).sort(),
        sampleMessages: Array.from(entry.sampleMessages.values()).slice(0, 3),
      }))
      .sort((a, b) => b.count - a.count),
  }
}

function buildSegmentMetrics(segments: TaskSegmentRecord[]): {
  overview: {
    totalSegments: number
    successSegments: number
    failedSegments: number
    runningSegments: number
    pendingSegments: number
    successRatePercent: number
    averageDurationMs: number
    maxDurationMs: number
  }
  byStage: Array<{
    stageName: string
    totalSegments: number
    successSegments: number
    failedSegments: number
    runningSegments: number
    pendingSegments: number
    successRatePercent: number
    averageDurationMs: number
    maxDurationMs: number
  }>
} {
  const stageGroups = new Map<string, TaskSegmentRecord[]>()
  for (const segment of segments) {
    const group = stageGroups.get(segment.stageName) ?? []
    group.push(segment)
    stageGroups.set(segment.stageName, group)
  }

  const durations = segments
    .map((segment) => segment.durationMs)
    .filter((duration): duration is number => typeof duration === 'number' && duration >= 0)
  const successSegments = segments.filter((segment) => segment.status === 'success').length
  const failedSegments = segments.filter((segment) => segment.status === 'failed').length
  const runningSegments = segments.filter((segment) => segment.status === 'running').length
  const pendingSegments = segments.filter((segment) => segment.status === 'pending').length

  const byStage = Array.from(stageGroups.entries())
    .map(([stageName, stageSegments]) => {
      const stageDurations = stageSegments
        .map((segment) => segment.durationMs)
        .filter((duration): duration is number => typeof duration === 'number' && duration >= 0)
      const stageSuccess = stageSegments.filter((segment) => segment.status === 'success').length
      const stageFailed = stageSegments.filter((segment) => segment.status === 'failed').length
      const stageRunning = stageSegments.filter((segment) => segment.status === 'running').length
      const stagePending = stageSegments.filter((segment) => segment.status === 'pending').length
      return {
        stageName,
        totalSegments: stageSegments.length,
        successSegments: stageSuccess,
        failedSegments: stageFailed,
        runningSegments: stageRunning,
        pendingSegments: stagePending,
        successRatePercent: safePercentage(stageSuccess, stageSegments.length),
        averageDurationMs:
          stageDurations.length > 0
            ? Math.round(stageDurations.reduce((sum, value) => sum + value, 0) / stageDurations.length)
            : 0,
        maxDurationMs: stageDurations.length > 0 ? Math.max(...stageDurations) : 0,
      }
    })
    .sort((a, b) => a.stageName.localeCompare(b.stageName))

  return {
    overview: {
      totalSegments: segments.length,
      successSegments,
      failedSegments,
      runningSegments,
      pendingSegments,
      successRatePercent: safePercentage(successSegments, segments.length),
      averageDurationMs:
        durations.length > 0
          ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
          : 0,
      maxDurationMs: durations.length > 0 ? Math.max(...durations) : 0,
    },
    byStage,
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

      const { dbPath, taskDao, taskStepDao, taskSegmentDao, taskRecoveryDao, artifactDao, settingsDao } = getDatabaseContext()
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
        const segments = taskSegmentDao.listByTask(payload.taskId)
        const snapshots = taskRecoveryDao.listSnapshots(payload.taskId, 200)
        const segmentMetrics = buildSegmentMetrics(segments)
        const segmentFailureSummary = summarizeSegmentFailures(segments)
        const recoveryPlan = getTaskEngine().getRecoveryPlan(payload.taskId)
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
          segmentMetrics,
          segmentFailureSummary,
          recoveryDecisionLog: {
            currentPlan: recoveryPlan,
            snapshots: snapshots.map((snapshot) => ({
              id: snapshot.id,
              stageName: snapshot.stageName,
              checkpointKey: snapshot.checkpointKey,
              createdAt: snapshot.createdAt,
              successfulSegmentCount: Array.isArray(snapshot.snapshotJson.successfulSegmentIds)
                ? snapshot.snapshotJson.successfulSegmentIds.length
                : 0,
              failedSegmentCount: Array.isArray(snapshot.snapshotJson.failedSegmentIds)
                ? snapshot.snapshotJson.failedSegmentIds.length
                : 0,
              checkpointSegmentId:
                typeof snapshot.snapshotJson.checkpointSegmentId === 'string'
                  ? snapshot.snapshotJson.checkpointSegmentId
                  : null,
            })),
          },
          segments,
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
