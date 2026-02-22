import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app, ipcMain, shell } from 'electron'
import type { AppSettings, TaskSegmentRecord } from '../../core/db/types'
import { getDatabaseContext } from '../../core/db'
import { installPiperRuntime } from '../../core/piper/installer'
import { getTaskEngine } from '../../core/task-engine'
import { runCommand } from '../../core/task-engine/command'
import { translateText } from '../../core/task-engine/modelProvider'
import {
  IPC_CHANNELS,
  type ExportDiagnosticsPayload,
  type ExportDiagnosticsResult,
  type InstallPiperPayload,
  type OpenPathPayload,
  type OpenPathResult,
  type PiperInstallResult,
  type PiperProbeCheckResult,
  type PiperProbeResult,
  type ProbePiperPayload,
  type TestTranslateConnectivityPayload,
  type TranslateConnectivityResult,
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

function maskLocalPath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) return ''
  const fileName = path.basename(trimmed)
  return fileName ? `***${fileName}` : '***'
}

function sanitizeSettings(
  settings: AppSettings,
): Omit<AppSettings, 'minimaxApiKey' | 'ytDlpCookiesFilePath'> & {
  minimaxApiKey: string
  ytDlpCookiesFilePath: string
} {
  return {
    ...settings,
    minimaxApiKey: maskSecret(settings.minimaxApiKey),
    ytDlpCookiesFilePath: maskLocalPath(settings.ytDlpCookiesFilePath),
    piperExecutablePath: maskLocalPath(settings.piperExecutablePath),
    piperModelPath: maskLocalPath(settings.piperModelPath),
    piperConfigPath: maskLocalPath(settings.piperConfigPath),
  }
}

function mergeSettingsWithPayload(
  baseSettings: AppSettings,
  payloadSettings?: Partial<AppSettings>,
): AppSettings {
  return {
    ...baseSettings,
    ...(payloadSettings ?? {}),
    retryPolicy: {
      ...baseSettings.retryPolicy,
      ...((payloadSettings?.retryPolicy as Partial<AppSettings['retryPolicy']> | undefined) ?? {}),
    },
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

function getPiperPlatformToken(): string | null {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64'
  if (process.platform === 'darwin' && process.arch === 'x64') return 'darwin-x64'
  if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64'
  if (process.platform === 'win32' && process.arch === 'arm64') return 'win32-arm64'
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64'
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64'
  return null
}

function getPiperResourceRoots(): string[] {
  return [
    process.resourcesPath,
    path.resolve(process.cwd(), 'resources'),
    process.env.APP_ROOT ? path.join(process.env.APP_ROOT, 'resources') : '',
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function looksLikePath(input: string): boolean {
  return input.includes('/') || input.includes('\\') || input.startsWith('.') || input.includes(':')
}

function resolveCandidatePaths(rawPath: string, roots: string[]): string[] {
  if (!rawPath.trim()) return []
  if (path.isAbsolute(rawPath)) return [rawPath]
  return [
    path.resolve(process.cwd(), rawPath),
    ...roots.map((root) => path.join(root, rawPath)),
    ...roots.map((root) => path.join(root, 'piper', rawPath)),
    ...roots.map((root) => path.join(root, 'piper', 'models', rawPath)),
  ]
}

async function resolveFirstExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // continue
    }
  }
  return null
}

async function verifyCommandRunnable(command: string): Promise<{ ok: boolean; message: string }> {
  const stderrLines: string[] = []
  try {
    await runCommand({
      command,
      args: ['--help'],
      timeoutMs: 5000,
      onStderrLine: (line) => {
        stderrLines.push(line)
      },
    })
    return { ok: true, message: '可执行（--help 通过）' }
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error)
    const detail = stderrLines.slice(-3).join(' | ')
    return {
      ok: false,
      message: detail ? `${baseMessage}; ${detail}` : baseMessage,
    }
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

let piperInstallInFlight: Promise<PiperInstallResult> | null = null

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

  ipcMain.handle(
    IPC_CHANNELS.systemInstallPiper,
    async (_event, payload: InstallPiperPayload = {}): Promise<PiperInstallResult> => {
      if (piperInstallInFlight) {
        return await piperInstallInFlight
      }

      piperInstallInFlight = (async () => {
        const { settingsDao, dbPath } = getDatabaseContext()
        const baseSettings = settingsDao.getSettings()
        const mergedSettings = mergeSettingsWithPayload(baseSettings, payload.settings)
        const dataRoot = path.dirname(dbPath)

        const installed = await installPiperRuntime({
          dataRoot,
          settings: mergedSettings,
          forceReinstall: payload.forceReinstall === true,
        })

        settingsDao.upsertSettings({
          piperExecutablePath: installed.piperExecutablePath,
          piperModelPath: installed.piperModelPath,
          piperConfigPath: installed.piperConfigPath,
        })

        return {
          summary: `Piper 安装完成（${installed.releaseTag}，音色 ${installed.voice}）`,
          releaseTag: installed.releaseTag,
          voice: installed.voice,
          piperExecutablePath: installed.piperExecutablePath,
          piperModelPath: installed.piperModelPath,
          piperConfigPath: installed.piperConfigPath,
        }
      })()

      try {
        return await piperInstallInFlight
      } finally {
        piperInstallInFlight = null
      }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.systemTestTranslateConnectivity,
    async (
      _event,
      payload: TestTranslateConnectivityPayload = {},
    ): Promise<TranslateConnectivityResult> => {
      const { settingsDao } = getDatabaseContext()
      const baseSettings = settingsDao.getSettings()
      const mergedSettings = mergeSettingsWithPayload(baseSettings, payload.settings)
      const timeoutMs = Math.max(5000, Math.min(20000, mergedSettings.stageTimeoutMs || 20000))

      try {
        const translatedText = await translateText({
          settings: mergedSettings,
          sourceText: 'This is a connectivity test.',
          targetLanguage: mergedSettings.defaultTargetLanguage,
          timeoutMs,
        })
        if (!translatedText.trim()) {
          return {
            ok: false,
            message: '翻译服务返回空响应',
          }
        }
        return {
          ok: true,
          message: '翻译服务连通测试通过',
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          ok: false,
          message: message.trim() || '翻译服务连通测试失败',
        }
      }
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.systemProbePiper,
    async (_event, payload: ProbePiperPayload = {}): Promise<PiperProbeResult> => {
      const { settingsDao } = getDatabaseContext()
      const baseSettings = settingsDao.getSettings()
      const mergedSettings: AppSettings = mergeSettingsWithPayload(baseSettings, payload.settings)

      const roots = getPiperResourceRoots()
      const platform = getPiperPlatformToken()
      const binaryName = process.platform === 'win32' ? 'piper.exe' : 'piper'

      const binaryCandidates: string[] = []
      const configuredBinary = mergedSettings.piperExecutablePath.trim()
      if (configuredBinary) {
        if (looksLikePath(configuredBinary)) {
          binaryCandidates.push(...resolveCandidatePaths(configuredBinary, roots))
        } else {
          binaryCandidates.push(configuredBinary)
        }
      } else {
        for (const root of roots) {
          if (platform) {
            binaryCandidates.push(path.join(root, 'piper', platform, binaryName))
          }
          binaryCandidates.push(path.join(root, 'piper', binaryName))
        }
        binaryCandidates.push('piper')
      }

      const modelRaw = mergedSettings.piperModelPath.trim()
      const modelCandidates = modelRaw ? resolveCandidatePaths(modelRaw, roots) : []
      const modelPath = await resolveFirstExisting(modelCandidates)

      const configRaw = mergedSettings.piperConfigPath.trim()
      const configCandidates = configRaw
        ? resolveCandidatePaths(configRaw, roots)
        : modelPath
          ? [`${modelPath}.json`]
          : []
      const configPath = await resolveFirstExisting(configCandidates)

      const binaryCandidate = binaryCandidates[0] ?? ''
      const binaryResolved =
        configuredBinary && looksLikePath(configuredBinary)
          ? await resolveFirstExisting(binaryCandidates)
          : binaryCandidate
      const binaryCommand = binaryResolved ?? binaryCandidate
      const binaryRun = binaryCommand
        ? await verifyCommandRunnable(binaryCommand)
        : { ok: false, message: '未找到 Piper 可执行文件' }
      const binaryResult: PiperProbeCheckResult = {
        ok: binaryRun.ok,
        path: binaryCommand || '(empty)',
        message: binaryRun.ok
          ? 'Piper 可执行文件可用'
          : `Piper 可执行文件不可用: ${binaryRun.message}`,
      }

      const modelResult: PiperProbeCheckResult = {
        ok: Boolean(modelPath),
        path: modelPath ?? modelRaw ?? '(empty)',
        message: modelPath
          ? '模型文件存在'
          : modelRaw
            ? '未找到模型文件（支持绝对路径、项目相对路径、resources/piper/models 相对路径）'
            : '未配置模型路径',
      }

      const configRequired = configRaw.length > 0
      const configResult: PiperProbeCheckResult = {
        ok: configRequired ? Boolean(configPath) : true,
        path: configPath ?? configRaw ?? (modelPath ? `${modelPath}.json` : '(empty)'),
        message: configPath
          ? '配置文件存在'
          : configRequired
            ? '配置文件不存在'
            : '未配置配置文件，已按可选项处理',
      }

      const ok = binaryResult.ok && modelResult.ok && configResult.ok
      return {
        ok,
        summary: ok ? 'Piper 环境就绪' : 'Piper 环境未就绪',
        binary: binaryResult,
        model: modelResult,
        config: configResult,
      }
    },
  )
}
