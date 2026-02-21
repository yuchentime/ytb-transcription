import { EventEmitter } from 'node:events'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ArtifactDao, SettingsDao, TaskDao, TaskStepDao } from '../db/dao'
import type { StepName, TaskStatus } from '../db/types'
import { runCommand } from './command'
import { minimaxSynthesize, minimaxTranslate } from './minimax'
import { ensureToolchain, type Toolchain } from './toolchain'

const STAGES: StepName[] = [
  'downloading',
  'extracting',
  'transcribing',
  'translating',
  'synthesizing',
  'merging',
]

const WHISPER_MODEL_URLS: Record<string, string> = {
  tiny: 'https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt',
  base: 'https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt',
  small:
    'https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt',
  medium:
    'https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt',
  large:
    'https://openaipublic.azureedge.net/main/whisper/models/e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb/large-v3.pt',
}

interface TaskEngineEvents {
  status: {
    taskId: string
    status: TaskStatus
    timestamp: string
  }
  progress: {
    taskId: string
    stage: StepName | 'queued'
    percent: number
    message: string
  }
  log: {
    taskId: string
    stage: StepName | 'engine'
    level: 'info' | 'warn' | 'error'
    text: string
    timestamp: string
  }
  completed: {
    taskId: string
    output: {
      ttsPath?: string
      transcriptPath?: string
      translationPath?: string
    }
  }
  failed: {
    taskId: string
    stage: StepName
    errorCode: string
    errorMessage: string
  }
  runtime: {
    taskId: string
    component: 'yt-dlp' | 'ffmpeg' | 'python' | 'whisper' | 'deno' | 'engine'
    status: 'checking' | 'downloading' | 'installing' | 'ready' | 'error'
    message: string
    timestamp: string
  }
}

interface TaskExecutionContext {
  taskId: string
  taskDir: string
  toolchain?: Toolchain
  videoPath?: string
  audioPath?: string
  transcriptPath?: string
  translationPath?: string
  ttsRawPath?: string
  finalTtsPath?: string
}

type EventName = keyof TaskEngineEvents
type Listener<T extends EventName> = (payload: TaskEngineEvents[T]) => void

function stageToStatus(stage: StepName): TaskStatus {
  return stage
}

function isRunningStatus(status: TaskStatus): boolean {
  return (
    status === 'queued' ||
    status === 'downloading' ||
    status === 'extracting' ||
    status === 'transcribing' ||
    status === 'translating' ||
    status === 'synthesizing' ||
    status === 'merging'
  )
}

function parsePercent(line: string): number | null {
  const match = line.match(/(\d{1,3}(?:\.\d+)?)%/)
  if (!match) return null
  const value = Number(match[1])
  if (Number.isNaN(value)) return null
  return Math.max(0, Math.min(100, Math.round(value)))
}

function parseWhisperDetectedLanguage(jsonContent: string): string | null {
  try {
    const parsed = JSON.parse(jsonContent) as { language?: unknown }
    return typeof parsed.language === 'string' ? parsed.language : null
  } catch {
    return null
  }
}

function shouldRetryWithTvClient(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('requested format is not available') ||
    lower.includes('only images are available') ||
    lower.includes('n challenge solving failed')
  )
}

function selectWhisperDevice(
  runtime: Toolchain['whisperRuntime'],
  model: string | null,
): 'cpu' | 'cuda' | 'mps' {
  if (runtime.cudaAvailable) return 'cuda'
  if (!runtime.mpsAvailable) return 'cpu'

  // For tiny/base models, CPU can be faster due to GPU scheduling overhead.
  if (model === 'tiny' || model === 'base') return 'cpu'
  return 'mps'
}

async function downloadToFile(url: string, filePath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`)
  }
  const content = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(filePath, content)
}

function parseWhisperModelHashFromUrl(url: string): string | null {
  const pathname = new URL(url).pathname
  const segments = pathname.split('/').filter(Boolean)
  const hash = segments[segments.length - 2] ?? ''
  return /^[a-f0-9]{64}$/i.test(hash) ? hash.toLowerCase() : null
}

async function computeSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: string | Buffer) => hash.update(typeof chunk === 'string' ? Buffer.from(chunk) : chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve())
  })
  return hash.digest('hex')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function downloadFileStream(url: string, filePath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`)
  }
  if (!response.body) {
    throw new Error('Download failed: empty response stream')
  }
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(filePath))
}

export class TaskEngine {
  private readonly emitter = new EventEmitter()
  private runningTaskId: string | null = null
  private readonly cancelRequested = new Set<string>()

  constructor(
    private readonly deps: {
      taskDao: TaskDao
      taskStepDao: TaskStepDao
      artifactDao: ArtifactDao
      settingsDao: SettingsDao
      artifactsRoot: string
      dataRoot: string
    },
  ) {}

  on<T extends EventName>(event: T, listener: Listener<T>): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return () => {
      this.emitter.off(event, listener as (...args: unknown[]) => void)
    }
  }

  start(taskId: string): { accepted: boolean; reason?: string } {
    if (this.runningTaskId && this.runningTaskId !== taskId) {
      return { accepted: false, reason: `Task ${this.runningTaskId} is already running` }
    }

    const task = this.deps.taskDao.getTaskById(taskId)
    if (this.runningTaskId === taskId || isRunningStatus(task.status)) {
      return { accepted: false, reason: 'Task is already running' }
    }

    this.deps.taskDao.updateTaskStatus(taskId, 'queued', {
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    })

    this.emit('status', { taskId, status: 'queued', timestamp: new Date().toISOString() })
    this.emit('progress', { taskId, stage: 'queued', percent: 0, message: 'Task queued' })

    this.runningTaskId = taskId
    void this.runTask(taskId)
    return { accepted: true }
  }

  retry(taskId: string): { accepted: boolean; reason?: string } {
    return this.start(taskId)
  }

  cancel(taskId: string): { canceled: boolean } {
    const task = this.deps.taskDao.getTaskById(taskId)
    if (task.status === 'queued' && this.runningTaskId !== taskId) {
      this.markCanceled(taskId)
      return { canceled: true }
    }
    if (this.runningTaskId === taskId) {
      this.cancelRequested.add(taskId)
      this.emit('log', {
        taskId,
        stage: 'engine',
        level: 'warn',
        text: 'Cancellation requested',
        timestamp: new Date().toISOString(),
      })
      return { canceled: true }
    }
    return { canceled: false }
  }

  private async runTask(taskId: string): Promise<void> {
    const context: TaskExecutionContext = {
      taskId,
      taskDir: path.join(this.deps.artifactsRoot, taskId),
    }

    try {
      await fs.mkdir(context.taskDir, { recursive: true })
      await this.ensureResources(context)

      for (const stage of STAGES) {
        const canceled = await this.runStage(context, stage)
        if (canceled) return
      }

      this.deps.taskDao.updateTaskStatus(taskId, 'completed', {
        completedAt: new Date().toISOString(),
        errorCode: null,
        errorMessage: null,
      })
      this.emit('status', { taskId, status: 'completed', timestamp: new Date().toISOString() })
      this.emit('completed', {
        taskId,
        output: {
          ttsPath: context.finalTtsPath,
          transcriptPath: context.transcriptPath,
          translationPath: context.translationPath,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown task error'
      this.deps.taskDao.updateTaskStatus(taskId, 'failed', {
        errorCode: 'E_TASK_FAILED',
        errorMessage: message,
        completedAt: new Date().toISOString(),
      })
      this.emit('status', { taskId, status: 'failed', timestamp: new Date().toISOString() })
      this.emit('log', {
        taskId,
        stage: 'engine',
        level: 'error',
        text: message,
        timestamp: new Date().toISOString(),
      })
    } finally {
      this.cancelRequested.delete(taskId)
      if (this.runningTaskId === taskId) {
        this.runningTaskId = null
      }
    }
  }

  private async ensureResources(context: TaskExecutionContext): Promise<void> {
    this.emit('log', {
      taskId: context.taskId,
      stage: 'engine',
      level: 'info',
      text: 'Checking runtime resources (yt-dlp/deno/ffmpeg/python-whisper)...',
      timestamp: new Date().toISOString(),
    })
    context.toolchain = await ensureToolchain(this.deps.dataRoot, {
      reporter: (event) => {
        this.emit('runtime', {
          taskId: context.taskId,
          component: event.component,
          status: event.status,
          message: event.message,
          timestamp: new Date().toISOString(),
        })
      },
    })
    this.emit('log', {
      taskId: context.taskId,
      stage: 'engine',
      level: 'info',
      text: 'Runtime resources are ready',
      timestamp: new Date().toISOString(),
    })
  }

  private async runStage(context: TaskExecutionContext, stage: StepName): Promise<boolean> {
    if (this.cancelRequested.has(context.taskId)) {
      this.markCanceled(context.taskId)
      return true
    }

    const stepId = this.deps.taskStepDao.startStep(context.taskId, stage)
    this.deps.taskDao.updateTaskStatus(context.taskId, stageToStatus(stage))
    this.emit('status', {
      taskId: context.taskId,
      status: stageToStatus(stage),
      timestamp: new Date().toISOString(),
    })
    this.emit('progress', {
      taskId: context.taskId,
      stage,
      percent: 1,
      message: `Starting ${stage}`,
    })

    try {
      if (stage === 'downloading') {
        await this.executeDownloading(context)
      } else if (stage === 'extracting') {
        await this.executeExtracting(context)
      } else if (stage === 'transcribing') {
        await this.executeTranscribing(context)
      } else if (stage === 'translating') {
        await this.executeTranslating(context)
      } else if (stage === 'synthesizing') {
        await this.executeSynthesizing(context)
      } else if (stage === 'merging') {
        await this.executeMerging(context)
      }
    } catch (error) {
      if (this.cancelRequested.has(context.taskId)) {
        this.deps.taskStepDao.skipStep(stepId, 'Canceled by user')
        this.markCanceled(context.taskId)
        return true
      }

      const message = error instanceof Error ? error.message : `Unknown error in ${stage}`
      this.deps.taskStepDao.failStep(stepId, `E_${stage.toUpperCase()}_FAILED`, message)
      this.deps.taskDao.updateTaskStatus(context.taskId, 'failed', {
        errorCode: `E_${stage.toUpperCase()}_FAILED`,
        errorMessage: message,
        completedAt: new Date().toISOString(),
      })
      this.emit('failed', {
        taskId: context.taskId,
        stage,
        errorCode: `E_${stage.toUpperCase()}_FAILED`,
        errorMessage: message,
      })
      this.emit('status', {
        taskId: context.taskId,
        status: 'failed',
        timestamp: new Date().toISOString(),
      })
      return true
    }

    this.deps.taskStepDao.finishStep(stepId)
    this.emit('progress', {
      taskId: context.taskId,
      stage,
      percent: 100,
      message: `${stage} done`,
    })
    this.emit('log', {
      taskId: context.taskId,
      stage,
      level: 'info',
      text: `Stage completed: ${stage}`,
      timestamp: new Date().toISOString(),
    })
    return false
  }

  private async executeDownloading(context: TaskExecutionContext): Promise<void> {
    const task = this.deps.taskDao.getTaskById(context.taskId)
    const settings = this.deps.settingsDao.getSettings()
    if (!context.toolchain) throw new Error('toolchain is not ready')
    const toolchain = context.toolchain
    const outputTemplate = path.join(context.taskDir, 'source.%(ext)s')
    const baseArgs = [
      '--newline',
      '--progress',
      '--js-runtimes',
      `deno:${toolchain.denoPath}`,
      '-f',
      'bestvideo*+bestaudio/best',
      '-S',
      '+res,+fps,+br,+size',
      '-o',
      outputTemplate,
    ]

    if (settings.ytDlpAuthMode === 'browser_cookies') {
      baseArgs.push('--cookies-from-browser', settings.ytDlpCookiesBrowser)
      this.emit('log', {
        taskId: context.taskId,
        stage: 'downloading',
        level: 'info',
        text: `Using browser cookies: ${settings.ytDlpCookiesBrowser}`,
        timestamp: new Date().toISOString(),
      })
    } else if (settings.ytDlpAuthMode === 'cookies_file') {
      const cookiesPath = settings.ytDlpCookiesFilePath.trim()
      if (!cookiesPath) {
        throw new Error('ytDlpCookiesFilePath is required when ytDlpAuthMode=cookies_file')
      }
      baseArgs.push('--cookies', cookiesPath)
      this.emit('log', {
        taskId: context.taskId,
        stage: 'downloading',
        level: 'info',
        text: 'Using cookies file for yt-dlp authentication',
        timestamp: new Date().toISOString(),
      })
    }
    baseArgs.push(task.youtubeUrl)

    const runDownload = async (args: string[]): Promise<void> => {
      const stderrLines: string[] = []
      await runCommand({
        command: toolchain.ytDlpPath,
        args,
        cwd: context.taskDir,
        isCanceled: () => this.cancelRequested.has(context.taskId),
        onStdoutLine: (line) => {
          const percent = parsePercent(line)
          if (percent !== null) {
            this.emit('progress', {
              taskId: context.taskId,
              stage: 'downloading',
              percent,
              message: line,
            })
          }
        },
        onStderrLine: (line) => {
          stderrLines.push(line)
          this.emit('log', {
            taskId: context.taskId,
            stage: 'downloading',
            level: 'info',
            text: line,
            timestamp: new Date().toISOString(),
          })
        },
      }).catch((error: unknown) => {
        const baseMessage = error instanceof Error ? error.message : 'yt-dlp command failed'
        const details = stderrLines.slice(-12).join('\n')
        throw new Error(details ? `${baseMessage}\n${details}` : baseMessage)
      })
    }

    try {
      await runDownload(baseArgs)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'yt-dlp command failed'
      if (!shouldRetryWithTvClient(message)) {
        throw error
      }

      this.emit('log', {
        taskId: context.taskId,
        stage: 'downloading',
        level: 'warn',
        text: 'Retrying yt-dlp with fallback extractor args: youtube:player_client=tv',
        timestamp: new Date().toISOString(),
      })
      const url = baseArgs[baseArgs.length - 1]
      const argsWithFallback = [
        ...baseArgs.slice(0, -1),
        '--extractor-args',
        'youtube:player_client=tv',
        url,
      ]
      await runDownload(argsWithFallback)
    }

    const files = await fs.readdir(context.taskDir)
    const candidates = files
      .filter((name) => name.startsWith('source.') && !name.endsWith('.part'))
      .map((name) => path.join(context.taskDir, name))

    if (candidates.length === 0) {
      throw new Error('yt-dlp completed but no source file was produced')
    }

    context.videoPath = candidates[0]
    this.deps.artifactDao.addArtifact({
      taskId: context.taskId,
      artifactType: 'video',
      filePath: context.videoPath,
      mimeType: 'video/mp4',
    })
  }

  private async executeExtracting(context: TaskExecutionContext): Promise<void> {
    if (!context.videoPath) throw new Error('videoPath is missing')
    if (!context.toolchain) throw new Error('toolchain is not ready')
    const toolchain = context.toolchain
    const outputPath = path.join(context.taskDir, 'audio.wav')
    context.audioPath = outputPath

    await runCommand({
      command: toolchain.ffmpegPath,
      args: ['-y', '-i', context.videoPath, '-vn', '-ac', '1', '-ar', '16000', outputPath],
      cwd: context.taskDir,
      isCanceled: () => this.cancelRequested.has(context.taskId),
      onStderrLine: (line) => {
        const percent = parsePercent(line)
        if (percent !== null) {
          this.emit('progress', {
            taskId: context.taskId,
            stage: 'extracting',
            percent,
            message: line,
          })
        }
      },
    })

    this.deps.artifactDao.addArtifact({
      taskId: context.taskId,
      artifactType: 'audio',
      filePath: outputPath,
      mimeType: 'audio/wav',
    })
  }

  private emitTranscribingLog(
    taskId: string,
    level: 'info' | 'warn' | 'error',
    text: string,
  ): void {
    this.emit('log', {
      taskId,
      stage: 'transcribing',
      level,
      text,
      timestamp: new Date().toISOString(),
    })
  }

  private async ensureWhisperModelReady(context: TaskExecutionContext, modelName: string): Promise<string> {
    const modelDir = path.join(this.deps.dataRoot, 'cache', 'whisper')
    await fs.mkdir(modelDir, { recursive: true })

    const modelUrl = WHISPER_MODEL_URLS[modelName]
    if (!modelUrl) {
      this.emitTranscribingLog(
        context.taskId,
        'warn',
        `No predownload URL for model "${modelName}", fallback to whisper default download behavior`,
      )
      return modelDir
    }

    const fileName = path.basename(new URL(modelUrl).pathname)
    const targetPath = path.join(modelDir, fileName)
    const tempPath = `${targetPath}.download`
    const expectedHash = parseWhisperModelHashFromUrl(modelUrl)

    try {
      await fs.access(targetPath)
      this.emitTranscribingLog(context.taskId, 'info', `Using cached whisper model: ${fileName}`)
      return modelDir
    } catch {
      // continue to download
    }

    const maxAttempts = 3
    let lastError: unknown = null
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.emitTranscribingLog(
        context.taskId,
        'info',
        `Downloading whisper model (${modelName}) attempt ${attempt}/${maxAttempts}`,
      )
      try {
        await fs.rm(tempPath, { force: true })
        try {
          await downloadFileStream(modelUrl, tempPath)
        } catch (error) {
          this.emitTranscribingLog(
            context.taskId,
            'warn',
            `Node download failed, fallback to curl: ${error instanceof Error ? error.message : 'unknown error'}`,
          )
          await runCommand({
            command: 'curl',
            args: [
              '-L',
              '--retry',
              '5',
              '--retry-delay',
              '2',
              '--retry-all-errors',
              '--fail',
              '-o',
              tempPath,
              modelUrl,
            ],
          })
        }

        if (expectedHash) {
          const actualHash = await computeSha256(tempPath)
          if (actualHash !== expectedHash) {
            throw new Error(
              `Model checksum mismatch for ${fileName}. expected=${expectedHash} actual=${actualHash}`,
            )
          }
        }

        await fs.rename(tempPath, targetPath)
        this.emitTranscribingLog(
          context.taskId,
          'info',
          `Whisper model ready: ${fileName} (${expectedHash ? 'sha256 verified' : 'no hash'})`,
        )
        return modelDir
      } catch (error) {
        lastError = error
        await fs.rm(tempPath, { force: true })
        if (attempt < maxAttempts) {
          await sleep(1200 * attempt)
        }
      }
    }

    throw new Error(
      `Failed to prepare whisper model "${modelName}" after ${maxAttempts} attempts: ${
        lastError instanceof Error ? lastError.message : 'unknown error'
      }`,
    )
  }

  private async executeTranscribing(context: TaskExecutionContext): Promise<void> {
    if (!context.audioPath) throw new Error('audioPath is missing')
    if (!context.toolchain) throw new Error('toolchain is not ready')
    const toolchain = context.toolchain
    const task = this.deps.taskDao.getTaskById(context.taskId)
    const modelName = task.whisperModel ?? 'base'
    const selectedDevice = selectWhisperDevice(context.toolchain.whisperRuntime, modelName)
    const modelDir = await this.ensureWhisperModelReady(context, modelName)
    const audioBaseName = path.basename(context.audioPath, path.extname(context.audioPath))
    const transcriptPath = path.join(context.taskDir, `${audioBaseName}.txt`)
    const jsonPath = path.join(context.taskDir, `${audioBaseName}.json`)

    const args = [
      '-m',
      'whisper',
      context.audioPath,
      '--model',
      modelName,
      '--model_dir',
      modelDir,
      '--device',
      selectedDevice,
      '--output_dir',
      context.taskDir,
      '--output_format',
      'all',
    ]
    if (selectedDevice === 'cpu') {
      // Avoid repetitive FP16 CPU warnings and keep logs readable.
      args.push('--fp16', 'False')
    }
    if (task.sourceLanguage) {
      args.push('--language', task.sourceLanguage)
    }

    this.emit('log', {
      taskId: context.taskId,
      stage: 'transcribing',
      level: 'info',
      text: `Whisper device selected: ${selectedDevice}`,
      timestamp: new Date().toISOString(),
    })

    const runWithDevice = async (device: 'cpu' | 'cuda' | 'mps'): Promise<void> => {
      const deviceArgs = args.map((item, idx) =>
        idx > 0 && args[idx - 1] === '--device' ? device : item,
      )
      if (device === 'cpu' && !deviceArgs.includes('--fp16')) {
        deviceArgs.push('--fp16', 'False')
      }
      await runCommand({
        command: toolchain.pythonPath,
        args: deviceArgs,
        cwd: context.taskDir,
        env: {
          XDG_CACHE_HOME: path.join(this.deps.dataRoot, 'cache'),
        },
        isCanceled: () => this.cancelRequested.has(context.taskId),
        onStderrLine: (line) => {
          this.emit('log', {
            taskId: context.taskId,
            stage: 'transcribing',
            level: 'info',
            text: line,
            timestamp: new Date().toISOString(),
          })
        },
      })
    }

    try {
      await runWithDevice(selectedDevice)
    } catch (error) {
      if (selectedDevice !== 'cpu') {
        this.emit('log', {
          taskId: context.taskId,
          stage: 'transcribing',
          level: 'warn',
          text: `Whisper ${selectedDevice} failed, retrying with CPU`,
          timestamp: new Date().toISOString(),
        })
        await runWithDevice('cpu')
      } else {
        throw error
      }
    }

    context.transcriptPath = transcriptPath
    this.deps.artifactDao.addArtifact({
      taskId: context.taskId,
      artifactType: 'transcript',
      filePath: transcriptPath,
      mimeType: 'text/plain',
    })

    if (!task.sourceLanguage) {
      const jsonText = await fs.readFile(jsonPath, 'utf-8')
      const language = parseWhisperDetectedLanguage(jsonText)
      if (language) {
        this.deps.taskDao.updateTaskStatus(context.taskId, 'transcribing', {
          sourceLanguage: language,
        })
      }
    }
  }

  private async executeTranslating(context: TaskExecutionContext): Promise<void> {
    if (!context.transcriptPath) throw new Error('transcriptPath is missing')
    const task = this.deps.taskDao.getTaskById(context.taskId)
    const settings = this.deps.settingsDao.getSettings()
    const sourceText = await fs.readFile(context.transcriptPath, 'utf-8')

    const translated = await minimaxTranslate({
      settings,
      sourceText,
      targetLanguage: task.targetLanguage,
    })

    const translationPath = path.join(context.taskDir, 'translation.txt')
    await fs.writeFile(translationPath, translated, 'utf-8')
    context.translationPath = translationPath
    this.deps.artifactDao.addArtifact({
      taskId: context.taskId,
      artifactType: 'translation',
      filePath: translationPath,
      mimeType: 'text/plain',
    })
  }

  private async executeSynthesizing(context: TaskExecutionContext): Promise<void> {
    if (!context.translationPath) throw new Error('translationPath is missing')
    const settings = this.deps.settingsDao.getSettings()
    const text = await fs.readFile(context.translationPath, 'utf-8')
    const ttsRawPath = path.join(context.taskDir, 'tts.raw.mp3')

    const { downloadUrl } = await minimaxSynthesize({
      settings,
      text,
    })
    await downloadToFile(downloadUrl, ttsRawPath)

    context.ttsRawPath = ttsRawPath
    this.deps.artifactDao.addArtifact({
      taskId: context.taskId,
      artifactType: 'tts',
      filePath: ttsRawPath,
      mimeType: 'audio/mpeg',
    })
  }

  private async executeMerging(context: TaskExecutionContext): Promise<void> {
    if (!context.ttsRawPath) throw new Error('ttsRawPath is missing')
    const finalPath = path.join(context.taskDir, 'tts.final.mp3')
    await fs.copyFile(context.ttsRawPath, finalPath)
    context.finalTtsPath = finalPath
  }

  private markCanceled(taskId: string): void {
    this.deps.taskDao.updateTaskStatus(taskId, 'canceled', {
      completedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
    })
    this.emit('status', { taskId, status: 'canceled', timestamp: new Date().toISOString() })
    this.emit('log', {
      taskId,
      stage: 'engine',
      level: 'warn',
      text: 'Task canceled',
      timestamp: new Date().toISOString(),
    })
  }

  private emit<T extends EventName>(event: T, payload: TaskEngineEvents[T]): void {
    this.emitter.emit(event, payload)
  }
}
