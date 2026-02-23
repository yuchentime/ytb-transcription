import fs from 'node:fs/promises'
import path from 'node:path'
import { app, ipcMain, shell } from 'electron'
import type { AppSettings } from '../../core/db/types'
import { getDatabaseContext } from '../../core/db'
import { installPiperRuntime } from '../../core/piper/installer'
import { runCommand } from '../../core/task-engine/command'
import { translateText } from '../../core/task-engine/modelProvider'
import {
  IPC_CHANNELS,
  type ExportTaskArtifactsPayload,
  type ExportTaskArtifactsResult,
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

function sanitizeFileNameSegment(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
}

function getLatestArtifactPath(
  artifacts: Array<{ artifactType: string; filePath: string }>,
  artifactType: string,
): string | null {
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const item = artifacts[index]
    if (item.artifactType === artifactType) return item.filePath
  }
  return null
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
    IPC_CHANNELS.systemExportTaskArtifacts,
    async (_event, payload: ExportTaskArtifactsPayload): Promise<ExportTaskArtifactsResult> => {
      if (!payload?.taskId || typeof payload.taskId !== 'string') {
        throw new Error('taskId is required')
      }

      const { taskDao, artifactDao } = getDatabaseContext()
      const task = taskDao.getTaskById(payload.taskId)
      const artifacts = artifactDao.listArtifacts(payload.taskId)

      const ttsPath = getLatestArtifactPath(artifacts, 'tts')
      const transcriptPath = getLatestArtifactPath(artifacts, 'transcript')
      const translationPath = getLatestArtifactPath(artifacts, 'translation')
      if (!ttsPath && !transcriptPath && !translationPath) {
        throw new Error('No exportable artifacts found for this task')
      }

      const timestamp = new Date().toISOString().replace(/[.:]/g, '-')
      const taskLabel = sanitizeFileNameSegment(task.youtubeTitle ?? '') || payload.taskId
      const exportDir = path.join(app.getPath('downloads'), 'ytb-transcription-exports', `${taskLabel}-${timestamp}`)
      await fs.mkdir(exportDir, { recursive: true })

      const exportedFiles: string[] = []

      if (ttsPath && (await fileExists(ttsPath))) {
        const ext = path.extname(ttsPath).toLowerCase() || '.mp3'
        const targetPath = path.join(exportDir, `${taskLabel}-audio${ext}`)
        await fs.copyFile(ttsPath, targetPath)
        exportedFiles.push(targetPath)
      }

      if (transcriptPath && (await fileExists(transcriptPath))) {
        const targetPath = path.join(exportDir, `${taskLabel}-transcript.txt`)
        await fs.copyFile(transcriptPath, targetPath)
        exportedFiles.push(targetPath)
      }

      if (translationPath && (await fileExists(translationPath))) {
        const targetPath = path.join(exportDir, `${taskLabel}-translation.txt`)
        await fs.copyFile(translationPath, targetPath)
        exportedFiles.push(targetPath)
      }

      if (exportedFiles.length === 0) {
        throw new Error('No exportable files exist on disk for this task')
      }

      return {
        exportDir,
        files: exportedFiles,
      }
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
