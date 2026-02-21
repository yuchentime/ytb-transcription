import { EventEmitter } from 'node:events'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  ArtifactDao,
  SettingsDao,
  TaskDao,
  TaskRecoveryDao,
  TaskSegmentDao,
  TaskStepDao,
} from '../db/dao'
import type {
  AppSettings,
  RecoveryPlan,
  SegmentStageName,
  SegmentationOptions,
  SegmentationStrategy,
  StepName,
  TaskSegmentRecord,
  TaskStatus,
} from '../db/types'
import { runCommand } from './command'
import { minimaxPolish, minimaxSynthesize, minimaxTranslate } from './minimax'
import { CheckpointStore } from './recovery/CheckpointStore'
import { RecoveryPlanner, classifyError } from './recovery/RecoveryPlanner'
import { assertSegmentIntegrity, segment, type TextSegment } from './segmentation'
import { ensureToolchain, type Toolchain } from './toolchain'
import { runWithConcurrency } from '../../services/minimax/ttsAsyncOrchestrator'

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

const MLX_MODEL_REPOS: Record<string, string[]> = {
  tiny: ['mlx-community/whisper-tiny-mlx', 'mlx-community/whisper-tiny'],
  base: ['mlx-community/whisper-base-mlx', 'mlx-community/whisper-base'],
  small: ['mlx-community/whisper-small-mlx', 'mlx-community/whisper-small'],
  medium: ['mlx-community/whisper-medium-mlx', 'mlx-community/whisper-medium'],
  large: ['mlx-community/whisper-large-v3-turbo'],
}

const DEFAULT_TRANSLATION_CONTEXT_CHARS = 160
const DEFAULT_TRANSLATE_REQUEST_TIMEOUT_MS = 120 * 1000
const DEFAULT_TRANSLATE_TIMEOUT_SPLIT_THRESHOLD_CHARS = 240
const DEFAULT_TRANSLATE_TIMEOUT_FALLBACK_MAX_CHARS = 450
const DEFAULT_TRANSLATE_TIMEOUT_FALLBACK_CONTEXT_CHARS = 120
const DEFAULT_TRANSLATE_TIMEOUT_FALLBACK_MIN_CHARS = 80
const DEFAULT_TRANSLATE_TIMEOUT_FALLBACK_MAX_DEPTH = 2
const DEFAULT_POLISH_CONTEXT_CHARS = 180
const DEFAULT_POLISH_TARGET_SEGMENT_LENGTH = 900
const DEFAULT_POLISH_MIN_DURATION_SEC = 10 * 60
const DEFAULT_TRANSCRIBE_CHUNK_ENABLED = true
const DEFAULT_TRANSCRIBE_CHUNK_MIN_DURATION_SEC = 10 * 60
const DEFAULT_TRANSCRIBE_CHUNK_DURATION_SEC = 4 * 60
const DEFAULT_TRANSCRIBE_CHUNK_OVERLAP_SEC = 1.2
const DEFAULT_TRANSCRIBE_CONCURRENCY = 2

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
  segmentProgress: {
    taskId: string
    stage: SegmentStageName
    segmentId: string
    index: number
    total: number
    percent: number
    message: string
  }
  segmentFailed: {
    taskId: string
    stage: SegmentStageName
    segmentId: string
    errorCode: string
    errorMessage: string
    retryable: boolean
  }
  recoverySuggested: {
    taskId: string
    actions: RecoveryPlan['actions']
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
  translationSegments?: TextSegment[]
  audioDurationSec?: number
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

function selectTranscribeBackend(
  runtime: Toolchain['whisperRuntime'],
  model: string | null,
): 'mlx' | 'openai-whisper' {
  if (
    process.platform === 'darwin' &&
    process.arch === 'arm64' &&
    runtime.mlxAvailable &&
    model !== 'tiny'
  ) {
    return 'mlx'
  }
  return 'openai-whisper'
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

type CheckpointComparableValue = string | number | boolean | null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toComparableNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toComparableString(value: unknown): string | null | undefined {
  if (typeof value === 'string') return value
  if (value === null) return null
  return undefined
}

function toComparableBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function formatComparableValue(value: CheckpointComparableValue | undefined): string {
  if (value === undefined) return 'undefined'
  return JSON.stringify(value)
}

function normalizeCheckpointStageName(stageName: unknown): StepName | null {
  if (typeof stageName !== 'string') return null
  const normalized = stageName.trim().toLowerCase()
  if (STAGES.includes(normalized as StepName)) {
    return normalized as StepName
  }

  if (normalized === 'translate' || normalized === 'translation') {
    return 'translating'
  }
  if (normalized === 'tts' || normalized === 'synthesize' || normalized === 'synthesis') {
    return 'synthesizing'
  }
  return null
}

function isSegmentStage(stageName: StepName): stageName is SegmentStageName {
  return stageName === 'translating' || stageName === 'synthesizing'
}

function parseFailedSegmentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string').map((id) => id.trim()).filter(Boolean)
}

function toSafeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

function parseDurationFromLine(line: string): number | null {
  const matched = line.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i)
  if (!matched) return null
  const hours = Number(matched[1])
  const minutes = Number(matched[2])
  const seconds = Number(matched[3])
  if ([hours, minutes, seconds].some((value) => Number.isNaN(value))) return null
  return hours * 3600 + minutes * 60 + seconds
}

function trimContextWindow(text: string, limit: number, fromEnd: boolean): string {
  const normalized = text.trim()
  if (!normalized || limit <= 0) return ''
  if (normalized.length <= limit) return normalized
  return fromEnd ? normalized.slice(-limit) : normalized.slice(0, limit)
}

function splitTextByHardLimit(text: string, maxChars: number): string[] {
  const normalized = text.trim()
  if (!normalized) return []
  if (maxChars <= 0 || normalized.length <= maxChars) return [normalized]

  const chunks: string[] = []
  let cursor = 0
  const boundaryPattern = /[\s,.!?;:，。！？；：、)\]】）}]/u
  while (cursor < normalized.length) {
    const remaining = normalized.length - cursor
    if (remaining <= maxChars) {
      chunks.push(normalized.slice(cursor))
      break
    }

    const hardEnd = Math.min(normalized.length, cursor + maxChars)
    const searchStart = Math.max(cursor + Math.floor(maxChars * 0.6), cursor + 1)
    let splitAt = hardEnd
    for (let pointer = hardEnd; pointer > searchStart; pointer -= 1) {
      if (boundaryPattern.test(normalized[pointer - 1] ?? '')) {
        splitAt = pointer
        break
      }
    }

    if (splitAt <= cursor) {
      splitAt = hardEnd
    }
    chunks.push(normalized.slice(cursor, splitAt))
    cursor = splitAt
  }

  return chunks.map((item) => item.trim()).filter(Boolean)
}

function mergeChunkTranscript(previousText: string, currentText: string): string {
  const previous = previousText.trim()
  const current = currentText.trim()
  if (!previous) return current
  if (!current) return previous

  const maxOverlap = Math.min(200, previous.length, current.length)
  for (let overlap = maxOverlap; overlap >= 16; overlap -= 1) {
    const prevTail = previous.slice(-overlap).toLowerCase()
    const currentHead = current.slice(0, overlap).toLowerCase()
    if (prevTail === currentHead) {
      return `${previous}${current.slice(overlap)}`
    }
  }
  return `${previous}\n${current}`
}

function resolveDominantLanguage(candidates: string[]): string | null {
  if (candidates.length === 0) return null
  const counts = new Map<string, number>()
  for (const language of candidates) {
    const normalized = language.trim().toLowerCase()
    if (!normalized) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return best
}

function buildComparableCheckpointConfig(config: Record<string, unknown>): Record<string, CheckpointComparableValue> {
  const comparable: Record<string, CheckpointComparableValue> = {}

  const directStringKeys = [
    'targetLanguage',
    'segmentationStrategy',
    'translateModelId',
    'ttsModelId',
    'ttsVoiceId',
  ] as const
  for (const key of directStringKeys) {
    const value = toComparableString(config[key])
    if (value !== undefined) {
      comparable[key] = value
    }
  }

  const directNumberKeys = ['ttsSpeed', 'ttsPitch', 'ttsVolume', 'ttsPollingConcurrency'] as const
  for (const key of directNumberKeys) {
    const value = toComparableNumber(config[key])
    if (value !== undefined) {
      comparable[key] = value
    }
  }
  const directBooleanKeys = ['autoPolishLongText', 'transcribeChunkEnabled'] as const
  for (const key of directBooleanKeys) {
    const value = toComparableBoolean(config[key])
    if (value !== undefined) {
      comparable[key] = value
    }
  }
  const extraNumberKeys = [
    'translationContextChars',
    'translateRequestTimeoutMs',
    'polishMinDurationSec',
    'polishContextChars',
    'polishTargetSegmentLength',
    'transcribeChunkMinDurationSec',
    'transcribeChunkDurationSec',
    'transcribeChunkOverlapSec',
  ] as const
  for (const key of extraNumberKeys) {
    const value = toComparableNumber(config[key])
    if (value !== undefined) {
      comparable[key] = value
    }
  }

  const segmentationOptions = isRecord(config.segmentationOptions) ? config.segmentationOptions : {}
  const maxCharsPerSegment = toComparableNumber(segmentationOptions.maxCharsPerSegment)
  const targetSegmentLength = toComparableNumber(segmentationOptions.targetSegmentLength)
  const targetDurationSec = toComparableNumber(segmentationOptions.targetDurationSec)
  if (maxCharsPerSegment !== undefined) {
    comparable['segmentationOptions.maxCharsPerSegment'] = maxCharsPerSegment
  }
  if (targetSegmentLength !== undefined) {
    comparable['segmentationOptions.targetSegmentLength'] = targetSegmentLength
  }
  if (targetDurationSec !== undefined) {
    comparable['segmentationOptions.targetDurationSec'] = targetDurationSec
  }

  return comparable
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
  private readonly retrySegmentRequests = new Map<string, Set<string>>()
  private readonly resumeFromStageRequests = new Map<string, StepName>()
  private readonly checkpointStore: CheckpointStore
  private readonly recoveryPlanner: RecoveryPlanner

  constructor(
    private readonly deps: {
      taskDao: TaskDao
      taskStepDao: TaskStepDao
      taskSegmentDao: TaskSegmentDao
      taskRecoveryDao: TaskRecoveryDao
      artifactDao: ArtifactDao
      settingsDao: SettingsDao
      artifactsRoot: string
      dataRoot: string
    },
  ) {
    this.checkpointStore = new CheckpointStore(deps.taskRecoveryDao, deps.taskSegmentDao)
    this.recoveryPlanner = new RecoveryPlanner(deps.taskSegmentDao, deps.taskRecoveryDao)
  }

  on<T extends EventName>(event: T, listener: Listener<T>): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return () => {
      this.emitter.off(event, listener as (...args: unknown[]) => void)
    }
  }

  private buildUniqueName(prefix: string): string {
    const normalizedPrefix =
      prefix
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'artifact'
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '')
    const token = randomUUID().replace(/-/g, '').slice(0, 10)
    return `${normalizedPrefix}-${timestamp}-${token}`
  }

  private buildUniqueFilePath(taskDir: string, prefix: string, extension: string): string {
    const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`
    return path.join(taskDir, `${this.buildUniqueName(prefix)}${normalizedExtension}`)
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

  listSegments(taskId: string): TaskSegmentRecord[] {
    return this.deps.taskSegmentDao.listByTask(taskId)
  }

  getRecoveryPlan(taskId: string): RecoveryPlan {
    return this.recoveryPlanner.createPlan(taskId)
  }

  retrySegments(taskId: string, segmentIds: string[]): { accepted: boolean; reason?: string } {
    if (!Array.isArray(segmentIds) || segmentIds.length === 0) {
      return { accepted: false, reason: 'segmentIds is required' }
    }
    if (this.runningTaskId && this.runningTaskId !== taskId) {
      return { accepted: false, reason: `Task ${this.runningTaskId} is already running` }
    }
    this.retrySegmentRequests.set(taskId, new Set(segmentIds))
    const allSegments = this.deps.taskSegmentDao.listByTask(taskId)
    const targetSegments = allSegments.filter((segment) => segmentIds.includes(segment.id))
    const hasTranslating = targetSegments.some((segment) => segment.stageName === 'translating')
    if (hasTranslating) {
      this.resumeFromStageRequests.set(taskId, 'translating')
    } else {
      this.resumeFromStageRequests.set(taskId, 'synthesizing')
    }
    return this.start(taskId)
  }

  resumeFromCheckpoint(taskId: string): { accepted: boolean; fromStage: string; reason?: string } {
    const snapshot = this.deps.taskRecoveryDao.getLatestSnapshot(taskId)
    if (!snapshot) {
      return { accepted: false, fromStage: '', reason: 'No checkpoint found' }
    }

    const stageName = this.resolveCheckpointStage(snapshot.stageName, snapshot.snapshotJson)
    if (!stageName) {
      return { accepted: false, fromStage: snapshot.stageName, reason: 'Checkpoint stage is invalid' }
    }

    const configCheck = this.validateCheckpointConfig(taskId, snapshot.snapshotJson.configSnapshot)
    if (!configCheck.accepted) {
      return {
        accepted: false,
        fromStage: stageName,
        reason: configCheck.reason,
      }
    }

    const retrySet = this.resolveResumeRetrySet(taskId, stageName, snapshot.snapshotJson.failedSegmentIds)
    if (retrySet.size > 0) {
      this.retrySegmentRequests.set(taskId, retrySet)
    } else {
      this.retrySegmentRequests.delete(taskId)
    }
    this.resumeFromStageRequests.set(taskId, stageName)

    const started = this.start(taskId)
    return {
      accepted: started.accepted,
      fromStage: stageName,
      reason: started.reason,
    }
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
      this.hydrateContextFromArtifacts(context)
      await this.ensureResources(context)

      const resumeStage = this.resumeFromStageRequests.get(taskId)
      const startStageIndex = resumeStage ? Math.max(0, STAGES.indexOf(resumeStage)) : 0
      const stagesToRun = STAGES.slice(startStageIndex)

      for (const stage of stagesToRun) {
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
      this.retrySegmentRequests.delete(taskId)
      this.resumeFromStageRequests.delete(taskId)
      if (this.runningTaskId === taskId) {
        this.runningTaskId = null
      }
    }
  }

  private hydrateContextFromArtifacts(context: TaskExecutionContext): void {
    const artifacts = this.deps.artifactDao.listArtifacts(context.taskId)
    for (let index = artifacts.length - 1; index >= 0; index -= 1) {
      const artifact = artifacts[index]
      if (!context.videoPath && artifact.artifactType === 'video') {
        context.videoPath = artifact.filePath
      } else if (!context.audioPath && artifact.artifactType === 'audio') {
        context.audioPath = artifact.filePath
      } else if (!context.transcriptPath && artifact.artifactType === 'transcript') {
        context.transcriptPath = artifact.filePath
      } else if (!context.translationPath && artifact.artifactType === 'translation') {
        context.translationPath = artifact.filePath
      } else if (!context.ttsRawPath && artifact.artifactType === 'tts') {
        context.ttsRawPath = artifact.filePath
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
      const recoveryPlan = this.recoveryPlanner.createPlan(context.taskId)
      if (recoveryPlan.actions.length > 0) {
        this.emit('recoverySuggested', {
          taskId: context.taskId,
          actions: recoveryPlan.actions,
        })
      }
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
    const downloadOutputBase = this.buildUniqueName('source-video')
    const outputTemplate = path.join(context.taskDir, `${downloadOutputBase}.%(ext)s`)
    const baseArgs = [
      '--newline',
      '--progress',
      '--js-runtimes',
      `deno:${toolchain.denoPath}`,
      '-f',
      'worst',
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
      .filter((name) => name.startsWith(`${downloadOutputBase}.`) && !name.endsWith('.part'))
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
    const outputPath = this.buildUniqueFilePath(context.taskDir, 'audio-extract', 'wav')
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

  private resolveTranslationContextChars(taskId: string): number {
    const task = this.deps.taskDao.getTaskById(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    return Math.floor(
      toSafeNumber(snapshot.translationContextChars, DEFAULT_TRANSLATION_CONTEXT_CHARS, 0, 500),
    )
  }

  private resolveTranslateRequestTimeoutMs(taskId: string): number {
    const task = this.deps.taskDao.getTaskById(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    return Math.floor(
      toSafeNumber(snapshot.translateRequestTimeoutMs, DEFAULT_TRANSLATE_REQUEST_TIMEOUT_MS, 15_000, 10 * 60 * 1000),
    )
  }

  private isTranslateTimeoutError(errorMessage: string): boolean {
    const normalized = errorMessage.toLowerCase()
    return normalized.includes('timeout') || normalized.includes('abort')
  }

  private isMiniMaxMissingContentError(errorMessage: string): boolean {
    const normalized = errorMessage.toLowerCase()
    return normalized.includes('missing content') && normalized.includes('1008')
  }

  private shouldUseTranslateSplitFallback(errorMessage: string, sourceText: string): boolean {
    if (!this.isTranslateTimeoutError(errorMessage)) return false
    return sourceText.trim().length >= DEFAULT_TRANSLATE_TIMEOUT_SPLIT_THRESHOLD_CHARS
  }

  private async translateWithSplitFallback(params: {
    settings: AppSettings
    sourceText: string
    targetLanguage: string
    timeoutMs: number
    contextChars: number
    previousContextText: string
    nextContextText: string
  }): Promise<{ text: string; pieceCount: number }> {
    const safeMaxChars = Math.max(
      240,
      Math.min(
        DEFAULT_TRANSLATE_TIMEOUT_FALLBACK_MAX_CHARS,
        Math.floor(params.sourceText.trim().length / 2),
      ),
    )
    const pieces = splitTextByHardLimit(params.sourceText, safeMaxChars)
    if (pieces.length <= 1) {
      throw new Error('Translate split fallback skipped: source cannot be split further')
    }

    const safeContextChars = Math.max(
      0,
      Math.min(params.contextChars, DEFAULT_TRANSLATE_TIMEOUT_FALLBACK_CONTEXT_CHARS),
    )
    const fallbackTimeoutMs = Math.max(15_000, Math.min(params.timeoutMs, 45_000))
    let translatedPieceCount = 0
    const translateRecursively = async (
      pieceText: string,
      depth: number,
      previousContextText: string,
      nextContextText: string,
    ): Promise<string> => {
      try {
        const translated = await minimaxTranslate({
          settings: params.settings,
          sourceText: pieceText,
          targetLanguage: params.targetLanguage,
          timeoutMs: fallbackTimeoutMs,
          context: {
            previousText: trimContextWindow(previousContextText, safeContextChars, true),
            nextText: trimContextWindow(nextContextText, safeContextChars, false),
          },
        })
        translatedPieceCount += 1
        return translated
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const canSplitDeeper =
          this.isTranslateTimeoutError(message) &&
          depth < DEFAULT_TRANSLATE_TIMEOUT_FALLBACK_MAX_DEPTH &&
          pieceText.trim().length >= DEFAULT_TRANSLATE_TIMEOUT_FALLBACK_MIN_CHARS * 2
        if (!canSplitDeeper) {
          throw error
        }

        const nextMaxChars = Math.max(
          DEFAULT_TRANSLATE_TIMEOUT_FALLBACK_MIN_CHARS,
          Math.floor(pieceText.trim().length / 2),
        )
        const nestedPieces = splitTextByHardLimit(pieceText, nextMaxChars)
        if (nestedPieces.length <= 1) {
          throw error
        }
        const nestedTranslated: string[] = []
        for (let index = 0; index < nestedPieces.length; index += 1) {
          const nestedPrevious =
            index > 0 ? nestedPieces[index - 1] ?? '' : previousContextText
          const nestedNext =
            index < nestedPieces.length - 1 ? nestedPieces[index + 1] ?? '' : nextContextText
          nestedTranslated.push(
            await translateRecursively(
              nestedPieces[index] ?? '',
              depth + 1,
              nestedPrevious,
              nestedNext,
            ),
          )
        }
        return nestedTranslated.join('\n')
      }
    }

    const translatedPieces: string[] = []
    for (let index = 0; index < pieces.length; index += 1) {
      const previousText = index > 0 ? pieces[index - 1] ?? '' : params.previousContextText
      const nextText = index < pieces.length - 1 ? pieces[index + 1] ?? '' : params.nextContextText
      translatedPieces.push(await translateRecursively(pieces[index] ?? '', 0, previousText, nextText))
    }

    return {
      text: translatedPieces.join('\n'),
      pieceCount: Math.max(translatedPieceCount, translatedPieces.length),
    }
  }

  private resolvePolishConfig(taskId: string): {
    autoPolishLongText: boolean
    minDurationSec: number
    contextChars: number
    targetSegmentLength: number
  } {
    const task = this.deps.taskDao.getTaskById(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    return {
      autoPolishLongText:
        typeof snapshot.autoPolishLongText === 'boolean'
          ? snapshot.autoPolishLongText
          : true,
      minDurationSec: Math.floor(
        toSafeNumber(snapshot.polishMinDurationSec, DEFAULT_POLISH_MIN_DURATION_SEC, 60, 24 * 3600),
      ),
      contextChars: Math.floor(
        toSafeNumber(snapshot.polishContextChars, DEFAULT_POLISH_CONTEXT_CHARS, 0, 500),
      ),
      targetSegmentLength: Math.floor(
        toSafeNumber(
          snapshot.polishTargetSegmentLength,
          DEFAULT_POLISH_TARGET_SEGMENT_LENGTH,
          200,
          2000,
        ),
      ),
    }
  }

  private resolveTranscribeChunkConfig(taskId: string): {
    enabled: boolean
    minDurationSec: number
    chunkDurationSec: number
    overlapSec: number
  } {
    const task = this.deps.taskDao.getTaskById(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    return {
      enabled:
        typeof snapshot.transcribeChunkEnabled === 'boolean'
          ? snapshot.transcribeChunkEnabled
          : DEFAULT_TRANSCRIBE_CHUNK_ENABLED,
      minDurationSec: Math.floor(
        toSafeNumber(
          snapshot.transcribeChunkMinDurationSec,
          DEFAULT_TRANSCRIBE_CHUNK_MIN_DURATION_SEC,
          60,
          24 * 3600,
        ),
      ),
      chunkDurationSec: Math.floor(
        toSafeNumber(
          snapshot.transcribeChunkDurationSec,
          DEFAULT_TRANSCRIBE_CHUNK_DURATION_SEC,
          60,
          20 * 60,
        ),
      ),
      overlapSec: toSafeNumber(snapshot.transcribeChunkOverlapSec, DEFAULT_TRANSCRIBE_CHUNK_OVERLAP_SEC, 0, 8),
    }
  }

  private resolveTranscribeConcurrency(
    taskId: string,
    backend: 'mlx' | 'openai-whisper',
    device: 'cpu' | 'cuda' | 'mps',
    totalChunks: number,
  ): number {
    const task = this.deps.taskDao.getTaskById(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    const requested = Math.floor(
      toSafeNumber(snapshot.transcribeConcurrency, DEFAULT_TRANSCRIBE_CONCURRENCY, 1, 2),
    )
    const backendSafeDefault = backend === 'openai-whisper' && device === 'cpu' ? requested : 1
    return Math.max(1, Math.min(backendSafeDefault, Math.max(1, totalChunks)))
  }

  private buildAudioChunkPlan(
    durationSec: number,
    chunkDurationSec: number,
    overlapSec: number,
  ): Array<{ index: number; startSec: number; durationSec: number }> {
    if (durationSec <= 0) return []
    const safeChunkSec = Math.max(60, chunkDurationSec)
    const safeOverlapSec = Math.max(0, Math.min(8, overlapSec))
    const plan: Array<{ index: number; startSec: number; durationSec: number }> = []
    let cursor = 0
    let index = 0
    while (cursor < durationSec - 0.01) {
      const startSec = index === 0 ? 0 : Math.max(0, cursor - safeOverlapSec)
      const nextCursor = Math.min(durationSec, cursor + safeChunkSec)
      const sectionDuration = Math.max(1, nextCursor - startSec)
      plan.push({ index, startSec, durationSec: sectionDuration })
      cursor = nextCursor
      index += 1
    }
    return plan
  }

  private async probeAudioDurationSec(audioPath: string, ffmpegPath: string): Promise<number | null> {
    const stderrLines: string[] = []
    await runCommand({
      command: ffmpegPath,
      args: ['-i', audioPath],
      onStderrLine: (line) => {
        stderrLines.push(line)
      },
    }).catch(() => undefined)

    for (const line of stderrLines) {
      const seconds = parseDurationFromLine(line)
      if (seconds !== null) return seconds
    }
    return null
  }

  private async polishTranslationText(params: {
    taskId: string
    targetLanguage: string
    settings: AppSettings
    text: string
    contextChars: number
    targetSegmentLength: number
    requestTimeoutMs: number
  }): Promise<string> {
    const polishSegments = segment(params.text, 'sentence', {
      targetSegmentLength: params.targetSegmentLength,
      maxCharsPerSegment: params.targetSegmentLength,
    })
    if (polishSegments.length === 0) return params.text

    const polishedChunks: string[] = []
    const maxAttempts = Math.max(1, Math.min(2, params.settings.retryPolicy.translate + 1))
    const polishTimeoutMs = Math.max(15_000, Math.min(params.requestTimeoutMs, 45_000))
    for (let index = 0; index < polishSegments.length; index += 1) {
      const item = polishSegments[index]
      const previousText =
        index > 0
          ? trimContextWindow(polishSegments[index - 1].text, params.contextChars, true)
          : ''
      const nextText =
        index < polishSegments.length - 1
          ? trimContextWindow(polishSegments[index + 1].text, params.contextChars, false)
          : ''

      let polished = ''
      let lastError: unknown = null
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const attemptStartedAt = Date.now()
        this.emit('log', {
          taskId: params.taskId,
          stage: 'translating',
          level: 'info',
          text: `Polish segment #${index + 1}/${polishSegments.length} attempt ${attempt}/${maxAttempts} (chars=${item.text.length}, timeoutMs=${polishTimeoutMs})`,
          timestamp: new Date().toISOString(),
        })
        try {
          polished = await minimaxPolish({
            settings: params.settings,
            sourceText: item.text,
            targetLanguage: params.targetLanguage,
            timeoutMs: polishTimeoutMs,
            context: {
              previousText,
              nextText,
            },
          })
          this.emit('log', {
            taskId: params.taskId,
            stage: 'translating',
            level: 'info',
            text: `Polish segment #${index + 1}/${polishSegments.length} attempt ${attempt} succeeded in ${
              Date.now() - attemptStartedAt
            }ms`,
            timestamp: new Date().toISOString(),
          })
          break
        } catch (error) {
          lastError = error
          const message = error instanceof Error ? error.message : String(error)
          this.emit('log', {
            taskId: params.taskId,
            stage: 'translating',
            level: 'warn',
            text: `Polish segment #${index + 1}/${polishSegments.length} attempt ${attempt} failed in ${
              Date.now() - attemptStartedAt
            }ms: ${message}`,
            timestamp: new Date().toISOString(),
          })
          const kind = classifyError('E_POLISH_SEGMENT', message)
          if (kind !== 'retryable' || attempt >= maxAttempts) {
            break
          }
          await sleep(Math.min(2_000, 1000 * (2 ** (attempt - 1))))
        }
      }
      if (!polished.trim()) {
        this.emit('log', {
          taskId: params.taskId,
          stage: 'translating',
          level: 'warn',
          text: `Polish segment fallback to original (#${index + 1}): ${
            lastError instanceof Error ? lastError.message : 'unknown error'
          }`,
          timestamp: new Date().toISOString(),
        })
        polishedChunks.push(item.text)
      } else {
        polishedChunks.push(polished)
      }
    }
    return polishedChunks.join('\n')
  }

  private async executeTranscribing(context: TaskExecutionContext): Promise<void> {
    if (!context.audioPath) throw new Error('audioPath is missing')
    if (!context.toolchain) throw new Error('toolchain is not ready')
    const toolchain = context.toolchain
    const task = this.deps.taskDao.getTaskById(context.taskId)
    const settings = this.resolveExecutionSettings(context.taskId)
    const modelName = task.whisperModel ?? 'base'
    const selectedDevice = selectWhisperDevice(context.toolchain.whisperRuntime, modelName)
    const selectedBackend = selectTranscribeBackend(context.toolchain.whisperRuntime, modelName)
    const transcriptPath = this.buildUniqueFilePath(context.taskDir, 'transcript-text', 'txt')
    const jsonPath = this.buildUniqueFilePath(context.taskDir, 'transcript-meta', 'json')
    const chunkConfig = this.resolveTranscribeChunkConfig(context.taskId)
    const audioDurationSec = await this.probeAudioDurationSec(context.audioPath, toolchain.ffmpegPath)
    if (audioDurationSec !== null) {
      context.audioDurationSec = audioDurationSec
    }

    this.emit('log', {
      taskId: context.taskId,
      stage: 'transcribing',
      level: 'info',
      text: `Transcribe backend=${selectedBackend}, device=${
        selectedBackend === 'mlx' ? 'metal(auto)' : selectedDevice
      }, durationSec=${audioDurationSec ?? 'unknown'}`,
      timestamp: new Date().toISOString(),
    })

    const runWithMlxRepo = async (
      audioPath: string,
      outputTxtPath: string,
      outputJsonPath: string,
      repo: string,
    ): Promise<void> => {
      const scriptLines = [
        'import json',
        'import pathlib',
        'import mlx_whisper',
        `audio = ${JSON.stringify(audioPath)}`,
        `repo = ${JSON.stringify(repo)}`,
        `language = ${task.sourceLanguage ? JSON.stringify(task.sourceLanguage) : 'None'}`,
        'kwargs = {"path_or_hf_repo": repo}',
        'if language:',
        '    kwargs["language"] = language',
        'result = mlx_whisper.transcribe(audio, **kwargs)',
        `txt_path = pathlib.Path(${JSON.stringify(outputTxtPath)})`,
        `json_path = pathlib.Path(${JSON.stringify(outputJsonPath)})`,
        'txt_path.write_text(result.get("text", ""), encoding="utf-8")',
        'json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")',
      ]

      await runCommand({
        command: toolchain.pythonPath,
        args: ['-c', scriptLines.join('\n')],
        cwd: context.taskDir,
        timeoutMs: settings.stageTimeoutMs,
        env: {
          XDG_CACHE_HOME: path.join(this.deps.dataRoot, 'cache'),
          HF_HOME: path.join(this.deps.dataRoot, 'cache', 'hf'),
          HF_HUB_DISABLE_IMPLICIT_TOKEN: '1',
          HF_TOKEN: '',
          HUGGINGFACE_HUB_TOKEN: '',
          HUGGING_FACE_HUB_TOKEN: '',
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

    const runWithMlx = async (
      audioPath: string,
      outputTxtPath: string,
      outputJsonPath: string,
    ): Promise<void> => {
      const repos = MLX_MODEL_REPOS[modelName]
      if (!repos || repos.length === 0) {
        throw new Error(`No MLX model mapping found for whisper model "${modelName}"`)
      }
      const failures: string[] = []
      for (const repo of repos) {
        this.emit('log', {
          taskId: context.taskId,
          stage: 'transcribing',
          level: 'info',
          text: `MLX trying model repo: ${repo}`,
          timestamp: new Date().toISOString(),
        })
        try {
          await runWithMlxRepo(audioPath, outputTxtPath, outputJsonPath, repo)
          this.emit('log', {
            taskId: context.taskId,
            stage: 'transcribing',
            level: 'info',
            text: `MLX model repo selected: ${repo}`,
            timestamp: new Date().toISOString(),
          })
          return
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          failures.push(`${repo}: ${reason}`)
          this.emit('log', {
            taskId: context.taskId,
            stage: 'transcribing',
            level: 'warn',
            text: `MLX model repo failed: ${repo}`,
            timestamp: new Date().toISOString(),
          })
        }
      }
      throw new Error(
        `MLX transcription failed for model "${modelName}" after trying repos (${repos.join(', ')}). Details: ${failures.join(' | ')}`,
      )
    }

    const runWithDevice = async (
      audioPath: string,
      outputDir: string,
      device: 'cpu' | 'cuda' | 'mps',
    ): Promise<{ whisperTxtPath: string; whisperJsonPath: string }> => {
      const modelDir = await this.ensureWhisperModelReady(context, modelName)
      const args = [
        '-m',
        'whisper',
        audioPath,
        '--model',
        modelName,
        '--model_dir',
        modelDir,
        '--device',
        device,
        '--output_dir',
        outputDir,
        '--output_format',
        'all',
      ]
      if (task.sourceLanguage) {
        args.push('--language', task.sourceLanguage)
      }
      if (device === 'cpu' && !args.includes('--fp16')) {
        args.push('--fp16', 'False')
      }

      await runCommand({
        command: toolchain.pythonPath,
        args,
        cwd: context.taskDir,
        timeoutMs: settings.stageTimeoutMs,
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

      const baseName = path.basename(audioPath, path.extname(audioPath))
      return {
        whisperTxtPath: path.join(outputDir, `${baseName}.txt`),
        whisperJsonPath: path.join(outputDir, `${baseName}.json`),
      }
    }

    const transcribeSingleAudio = async (
      audioPath: string,
      outputTxtPath: string,
      outputJsonPath: string,
    ): Promise<void> => {
      const applyOpenaiOutput = async (
        generated: { whisperTxtPath: string; whisperJsonPath: string },
      ): Promise<void> => {
        if (generated.whisperTxtPath !== outputTxtPath) {
          await fs.copyFile(generated.whisperTxtPath, outputTxtPath)
          await fs.rm(generated.whisperTxtPath, { force: true })
        }
        if (generated.whisperJsonPath !== outputJsonPath) {
          await fs.copyFile(generated.whisperJsonPath, outputJsonPath)
          await fs.rm(generated.whisperJsonPath, { force: true })
        }
      }

      try {
        if (selectedBackend === 'mlx') {
          await runWithMlx(audioPath, outputTxtPath, outputJsonPath)
          return
        }
        const generated = await runWithDevice(audioPath, path.dirname(outputTxtPath), selectedDevice)
        await applyOpenaiOutput(generated)
      } catch (error) {
        if (selectedBackend === 'mlx') {
          this.emit('log', {
            taskId: context.taskId,
            stage: 'transcribing',
            level: 'warn',
            text: 'MLX backend failed, fallback to openai-whisper backend',
            timestamp: new Date().toISOString(),
          })
          if (selectedDevice !== 'cpu') {
            try {
              const generated = await runWithDevice(audioPath, path.dirname(outputTxtPath), selectedDevice)
              await applyOpenaiOutput(generated)
            } catch {
              this.emit('log', {
                taskId: context.taskId,
                stage: 'transcribing',
                level: 'warn',
                text: `Whisper ${selectedDevice} failed, retrying with CPU`,
                timestamp: new Date().toISOString(),
              })
              const generated = await runWithDevice(audioPath, path.dirname(outputTxtPath), 'cpu')
              await applyOpenaiOutput(generated)
            }
          } else {
            const generated = await runWithDevice(audioPath, path.dirname(outputTxtPath), 'cpu')
            await applyOpenaiOutput(generated)
          }
          return
        }
        if (selectedDevice !== 'cpu') {
          this.emit('log', {
            taskId: context.taskId,
            stage: 'transcribing',
            level: 'warn',
            text: `Whisper ${selectedDevice} failed, retrying with CPU`,
            timestamp: new Date().toISOString(),
          })
          const generated = await runWithDevice(audioPath, path.dirname(outputTxtPath), 'cpu')
          await applyOpenaiOutput(generated)
          return
        }
        throw error
      }
    }

    const runTranscribeWithRetry = async (
      audioPath: string,
      outputTxtPath: string,
      outputJsonPath: string,
    ): Promise<void> => {
      const maxAttempts = Math.max(1, settings.retryPolicy.transcribe + 1)
      let lastError: unknown = null
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          await transcribeSingleAudio(audioPath, outputTxtPath, outputJsonPath)
          return
        } catch (error) {
          lastError = error
          if (attempt >= maxAttempts) break
          this.emit('log', {
            taskId: context.taskId,
            stage: 'transcribing',
            level: 'warn',
            text: `Transcribing retry attempt ${attempt + 1}/${maxAttempts}`,
            timestamp: new Date().toISOString(),
          })
          await sleep(Math.min(5_000, 1000 * (2 ** (attempt - 1))))
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Unknown transcribing error')
    }

    const useChunkMode =
      chunkConfig.enabled &&
      typeof audioDurationSec === 'number' &&
      Number.isFinite(audioDurationSec) &&
      audioDurationSec >= chunkConfig.minDurationSec

    if (!useChunkMode) {
      await runTranscribeWithRetry(context.audioPath, transcriptPath, jsonPath)
    } else {
      const chunkPlan = this.buildAudioChunkPlan(
        audioDurationSec,
        chunkConfig.chunkDurationSec,
        chunkConfig.overlapSec,
      )
      const chunkDir = path.join(context.taskDir, this.buildUniqueName('audio-chunks'))
      await fs.mkdir(chunkDir, { recursive: true })
      const chunkEntries: Array<{ index: number; startSec: number; durationSec: number; path: string }> = []
      for (const plan of chunkPlan) {
        const chunkPath = path.join(chunkDir, `audio-chunk-${plan.index.toString().padStart(4, '0')}.wav`)
        await runCommand({
          command: toolchain.ffmpegPath,
          args: [
            '-y',
            '-ss',
            plan.startSec.toFixed(3),
            '-t',
            plan.durationSec.toFixed(3),
            '-i',
            context.audioPath,
            '-vn',
            '-ac',
            '1',
            '-ar',
            '16000',
            chunkPath,
          ],
          cwd: context.taskDir,
          timeoutMs: settings.stageTimeoutMs,
          isCanceled: () => this.cancelRequested.has(context.taskId),
        })
        chunkEntries.push({
          index: plan.index,
          startSec: plan.startSec,
          durationSec: plan.durationSec,
          path: chunkPath,
        })
      }

      const chunkConcurrency = this.resolveTranscribeConcurrency(
        context.taskId,
        selectedBackend,
        selectedDevice,
        chunkEntries.length,
      )
      this.emit('log', {
        taskId: context.taskId,
        stage: 'transcribing',
        level: 'info',
        text: `Chunked transcribing enabled: chunks=${chunkEntries.length}, concurrency=${chunkConcurrency}, chunkSec=${chunkConfig.chunkDurationSec}, overlapSec=${chunkConfig.overlapSec}`,
        timestamp: new Date().toISOString(),
      })

      const tasks = chunkEntries.map((chunk) => async () => {
        const chunkTxtPath = path.join(chunkDir, `chunk-${chunk.index.toString().padStart(4, '0')}.txt`)
        const chunkJsonPath = path.join(chunkDir, `chunk-${chunk.index.toString().padStart(4, '0')}.json`)
        await runTranscribeWithRetry(chunk.path, chunkTxtPath, chunkJsonPath)
        const text = await fs.readFile(chunkTxtPath, 'utf-8')
        const jsonText = await fs.readFile(chunkJsonPath, 'utf-8')
        const language = parseWhisperDetectedLanguage(jsonText)
        return {
          index: chunk.index,
          startSec: chunk.startSec,
          durationSec: chunk.durationSec,
          text: text.trim(),
          language,
        }
      })

      const chunkResults = await runWithConcurrency(tasks, chunkConcurrency)
      const ordered = [...chunkResults].sort((a, b) => a.index - b.index)
      let mergedText = ''
      const languages: string[] = []
      const chunkSummary = ordered.map((item) => {
        mergedText = mergeChunkTranscript(mergedText, item.text)
        if (item.language) languages.push(item.language)
        return {
          index: item.index,
          startSec: item.startSec,
          durationSec: item.durationSec,
          charLength: item.text.length,
          language: item.language ?? null,
        }
      })

      const dominantLanguage = resolveDominantLanguage(languages)
      await fs.writeFile(transcriptPath, mergedText, 'utf-8')
      await fs.writeFile(
        jsonPath,
        JSON.stringify(
          {
            language: dominantLanguage,
            chunked: true,
            chunkCount: chunkSummary.length,
            chunkOverlapSec: chunkConfig.overlapSec,
            chunks: chunkSummary,
          },
          null,
          2,
        ),
        'utf-8',
      )
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

  private resolveSegmentationConfig(taskId: string): {
    strategy: SegmentationStrategy
    options: SegmentationOptions
  } {
    const task = this.deps.taskDao.getTaskById(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    const strategyRaw = snapshot.segmentationStrategy
    const strategy: SegmentationStrategy =
      strategyRaw === 'sentence' || strategyRaw === 'duration' ? strategyRaw : 'punctuation'
    const optionsRaw =
      snapshot.segmentationOptions && typeof snapshot.segmentationOptions === 'object'
        ? (snapshot.segmentationOptions as Record<string, unknown>)
        : {}
    const toNumber = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined

    return {
      strategy,
      options: {
        maxCharsPerSegment: toNumber(optionsRaw.maxCharsPerSegment),
        targetSegmentLength: toNumber(optionsRaw.targetSegmentLength),
        targetDurationSec: toNumber(optionsRaw.targetDurationSec),
      },
    }
  }

  private resolveRetrySet(taskId: string): Set<string> | null {
    return this.retrySegmentRequests.get(taskId) ?? null
  }

  private async ensureStageSegments(
    taskId: string,
    stageName: SegmentStageName,
    segments: TextSegment[],
  ): Promise<TaskSegmentRecord[]> {
    const existing = this.deps.taskSegmentDao.listByTaskAndStage(taskId, stageName)
    const hasShapeChanged =
      existing.length !== segments.length ||
      existing.some((segment, index) => {
        const source = segments[index]
        return !source || segment.segmentIndex !== source.index || (segment.sourceText ?? '') !== source.text
      })
    if (hasShapeChanged) {
      this.deps.taskSegmentDao.clearByTaskAndStage(taskId, stageName)
      return this.deps.taskSegmentDao.createSegments(
        taskId,
        stageName,
        segments.map((segment) => ({
          id: segment.id,
          segmentIndex: segment.index,
          sourceText: segment.text,
          status: 'pending',
        })),
      )
    }
    return existing
  }

  private buildCheckpointConfig(taskId: string): Record<string, unknown> {
    const task = this.deps.taskDao.getTaskById(taskId)
    const settings = this.resolveExecutionSettings(taskId)
    const segmentation = this.resolveSegmentationConfig(taskId)
    const polish = this.resolvePolishConfig(taskId)
    const transcribeChunk = this.resolveTranscribeChunkConfig(taskId)
    const translationContextChars = this.resolveTranslationContextChars(taskId)
    const translateRequestTimeoutMs = this.resolveTranslateRequestTimeoutMs(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    const ttsPollingConcurrency =
      typeof snapshot.ttsPollingConcurrency === 'number' && Number.isFinite(snapshot.ttsPollingConcurrency)
        ? Math.floor(snapshot.ttsPollingConcurrency)
        : undefined

    return {
      targetLanguage: task.targetLanguage,
      segmentationStrategy: segmentation.strategy,
      segmentationOptions: segmentation.options,
      translateModelId: settings.translateModelId,
      ttsModelId: settings.ttsModelId,
      ttsVoiceId: settings.ttsVoiceId,
      ttsSpeed: settings.ttsSpeed,
      ttsPitch: settings.ttsPitch,
      ttsVolume: settings.ttsVolume,
      ttsPollingConcurrency,
      translationContextChars,
      translateRequestTimeoutMs,
      autoPolishLongText: polish.autoPolishLongText,
      polishMinDurationSec: polish.minDurationSec,
      polishContextChars: polish.contextChars,
      polishTargetSegmentLength: polish.targetSegmentLength,
      transcribeChunkEnabled: transcribeChunk.enabled,
      transcribeChunkMinDurationSec: transcribeChunk.minDurationSec,
      transcribeChunkDurationSec: transcribeChunk.chunkDurationSec,
      transcribeChunkOverlapSec: transcribeChunk.overlapSec,
    }
  }

  private resolveCheckpointStage(
    stageName: string,
    snapshotJson: Record<string, unknown>,
  ): StepName | null {
    const fromStageColumn = normalizeCheckpointStageName(stageName)
    if (fromStageColumn) return fromStageColumn
    return normalizeCheckpointStageName(snapshotJson.stageName)
  }

  private validateCheckpointConfig(
    taskId: string,
    snapshotConfig: unknown,
  ): { accepted: boolean; reason?: string } {
    if (!isRecord(snapshotConfig)) {
      return {
        accepted: false,
        reason: 'Checkpoint config snapshot is missing',
      }
    }

    const expected = buildComparableCheckpointConfig(snapshotConfig)
    if (Object.keys(expected).length === 0) {
      return {
        accepted: false,
        reason: 'Checkpoint config snapshot is empty',
      }
    }

    const currentConfig = buildComparableCheckpointConfig(this.buildCheckpointConfig(taskId))
    const mismatches: string[] = []
    for (const [key, expectedValue] of Object.entries(expected)) {
      const currentValue = currentConfig[key]
      if (currentValue !== expectedValue) {
        mismatches.push(
          `${key}: checkpoint=${formatComparableValue(expectedValue)}, current=${formatComparableValue(currentValue)}`,
        )
      }
    }

    if (mismatches.length > 0) {
      return {
        accepted: false,
        reason: `Checkpoint config mismatch. ${mismatches.slice(0, 3).join(' | ')}`,
      }
    }

    return { accepted: true }
  }

  private resolveResumeRetrySet(
    taskId: string,
    stageName: StepName,
    snapshotFailedSegmentIds: unknown,
  ): Set<string> {
    const retrySet = new Set<string>(parseFailedSegmentIds(snapshotFailedSegmentIds))
    if (!isSegmentStage(stageName)) {
      return retrySet
    }

    const unresolved = this.deps.taskSegmentDao
      .listByTaskAndStage(taskId, stageName)
      .filter((segment) => segment.status !== 'success')
      .map((segment) => segment.id)
    for (const segmentId of unresolved) {
      retrySet.add(segmentId)
    }
    return retrySet
  }

  private assertStageSegmentIntegrity(
    stageName: SegmentStageName,
    dbSegments: TaskSegmentRecord[],
    expectedSegments: TextSegment[],
  ): TaskSegmentRecord[] {
    const ordered = [...dbSegments].sort((a, b) => a.segmentIndex - b.segmentIndex)
    if (ordered.length !== expectedSegments.length) {
      throw new Error(
        `${stageName} segment count mismatch: expected ${expectedSegments.length}, got ${ordered.length}`,
      )
    }

    for (let index = 0; index < ordered.length; index += 1) {
      const record = ordered[index]
      const expected = expectedSegments[index]
      if (!record || !expected) {
        throw new Error(`${stageName} segment missing at index ${index}`)
      }
      if (record.segmentIndex !== index) {
        throw new Error(
          `${stageName} segment order mismatch at index ${index}: got segmentIndex=${record.segmentIndex}`,
        )
      }
      if ((record.sourceText ?? '') !== expected.text) {
        throw new Error(
          `${stageName} segment source mismatch at index ${index}`,
        )
      }
    }

    return ordered
  }

  private resolveTtsConcurrency(taskId: string, totalSegments: number): number {
    const task = this.deps.taskDao.getTaskById(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    const requested = snapshot.ttsPollingConcurrency
    const configured =
      typeof requested === 'number' && Number.isFinite(requested)
        ? Math.floor(requested)
        : 3
    return Math.max(1, Math.min(3, configured, Math.max(1, totalSegments)))
  }

  private resolveExecutionSettings(taskId: string): AppSettings {
    const base = this.deps.settingsDao.getSettings()
    const task = this.deps.taskDao.getTaskById(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>

    const resolved: AppSettings = {
      ...base,
    }
    const patchString = (key: 'translateModelId' | 'ttsModelId' | 'ttsVoiceId'): void => {
      const value = snapshot[key]
      if (typeof value === 'string') {
        resolved[key] = value
      }
    }
    const patchNumber = (key: 'ttsSpeed' | 'ttsPitch' | 'ttsVolume'): void => {
      const value = snapshot[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        resolved[key] = value
      }
    }

    patchString('translateModelId')
    patchString('ttsModelId')
    patchString('ttsVoiceId')
    patchNumber('ttsSpeed')
    patchNumber('ttsPitch')
    patchNumber('ttsVolume')

    return resolved
  }

  private async executeTranslating(context: TaskExecutionContext): Promise<void> {
    if (!context.transcriptPath) throw new Error('transcriptPath is missing')
    const task = this.deps.taskDao.getTaskById(context.taskId)
    const settings = this.resolveExecutionSettings(context.taskId)
    const translationContextChars = this.resolveTranslationContextChars(context.taskId)
    const translateRequestTimeoutMs = this.resolveTranslateRequestTimeoutMs(context.taskId)
    const polishConfig = this.resolvePolishConfig(context.taskId)
    const sourceText = await fs.readFile(context.transcriptPath, 'utf-8')
    const segmentation = this.resolveSegmentationConfig(context.taskId)
    const segments = segment(sourceText, segmentation.strategy, segmentation.options)
    assertSegmentIntegrity(sourceText, segments)

    const retrySet = this.resolveRetrySet(context.taskId)
    const stageSegments = await this.ensureStageSegments(context.taskId, 'translating', segments)
    const total = stageSegments.length
    let completed = stageSegments.filter((segment) => segment.status === 'success').length
    const failedSegmentErrors: string[] = []

    const maxAttempts = Math.max(1, settings.retryPolicy.translate + 1)
    for (const segment of stageSegments) {
      if (this.cancelRequested.has(context.taskId)) {
        throw new Error('Task canceled')
      }
      if (segment.status === 'success' && (!retrySet || !retrySet.has(segment.id))) {
        continue
      }
      if (retrySet && !retrySet.has(segment.id)) {
        continue
      }

      this.deps.taskSegmentDao.markSegmentRunning(segment.id)
      let translatedText: string | null = null
      let lastError: unknown = null
      const segmentSourceText = segment.sourceText ?? ''
      const previousSegmentText =
        segment.segmentIndex > 0
          ? stageSegments[segment.segmentIndex - 1]?.sourceText ?? ''
          : ''
      const nextSegmentText =
        segment.segmentIndex < total - 1
          ? stageSegments[segment.segmentIndex + 1]?.sourceText ?? ''
          : ''
      let splitFallbackAttempted = false

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const attemptStartedAt = Date.now()
        this.emit('log', {
          taskId: context.taskId,
          stage: 'translating',
          level: 'info',
          text: `Translate segment #${segment.segmentIndex + 1}/${total} attempt ${attempt}/${maxAttempts} (chars=${segmentSourceText.length}, timeoutMs=${translateRequestTimeoutMs})`,
          timestamp: new Date().toISOString(),
        })
        try {
          translatedText = await minimaxTranslate({
            settings,
            sourceText: segmentSourceText,
            targetLanguage: task.targetLanguage,
            timeoutMs: translateRequestTimeoutMs,
            context: {
              previousText: trimContextWindow(previousSegmentText, translationContextChars, true),
              nextText: trimContextWindow(nextSegmentText, translationContextChars, false),
              segmentIndex: segment.segmentIndex,
              totalSegments: total,
            },
          })
          this.emit('log', {
            taskId: context.taskId,
            stage: 'translating',
            level: 'info',
            text: `Translate segment #${segment.segmentIndex + 1}/${total} attempt ${attempt} succeeded in ${
              Date.now() - attemptStartedAt
            }ms`,
            timestamp: new Date().toISOString(),
          })
          break
        } catch (error) {
          lastError = error
          let message = error instanceof Error ? error.message : String(error)
          this.emit('log', {
            taskId: context.taskId,
            stage: 'translating',
            level: 'warn',
            text: `Translate segment #${segment.segmentIndex + 1}/${total} attempt ${attempt} failed in ${
              Date.now() - attemptStartedAt
            }ms: ${message}`,
            timestamp: new Date().toISOString(),
          })

          if (
            !splitFallbackAttempted &&
            this.shouldUseTranslateSplitFallback(message, segmentSourceText)
          ) {
            splitFallbackAttempted = true
            const fallbackStartedAt = Date.now()
            try {
              this.emit('log', {
                taskId: context.taskId,
                stage: 'translating',
                level: 'info',
                text: `Translate segment #${segment.segmentIndex + 1}/${total} switching to split fallback`,
                timestamp: new Date().toISOString(),
              })
              const fallbackResult = await this.translateWithSplitFallback({
                settings,
                sourceText: segmentSourceText,
                targetLanguage: task.targetLanguage,
                timeoutMs: translateRequestTimeoutMs,
                contextChars: translationContextChars,
                previousContextText: previousSegmentText,
                nextContextText: nextSegmentText,
              })
              translatedText = fallbackResult.text
              this.emit('log', {
                taskId: context.taskId,
                stage: 'translating',
                level: 'info',
                text: `Translate segment #${segment.segmentIndex + 1}/${total} split fallback succeeded in ${
                  Date.now() - fallbackStartedAt
                }ms (pieces=${fallbackResult.pieceCount})`,
                timestamp: new Date().toISOString(),
              })
              break
            } catch (fallbackError) {
              lastError = fallbackError
              const fallbackMessage =
                fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
              message = fallbackMessage
              this.emit('log', {
                taskId: context.taskId,
                stage: 'translating',
                level: 'warn',
                text: `Translate segment #${segment.segmentIndex + 1}/${total} split fallback failed in ${
                  Date.now() - fallbackStartedAt
                }ms: ${fallbackMessage}`,
                timestamp: new Date().toISOString(),
              })
            }
          }

          const kind = classifyError('E_TRANSLATE_SEGMENT', message)
          if (kind !== 'retryable' || attempt >= maxAttempts) {
            break
          }
          const isMissingContent = this.isMiniMaxMissingContentError(message)
          if (isMissingContent) {
            await sleep(Math.min(30_000, 10_000 * attempt))
            continue
          }
          await sleep(Math.min(4_000, 1000 * (2 ** (attempt - 1))))
        }
      }

      if (!translatedText) {
        const message =
          lastError instanceof Error ? lastError.message : 'Unknown translating segment error'
        this.deps.taskSegmentDao.markSegmentFailed(segment.id, {
          errorCode: 'E_TRANSLATE_SEGMENT',
          errorMessage: message,
          incrementRetry: true,
        })
        this.emit('segmentFailed', {
          taskId: context.taskId,
          stage: 'translating',
          segmentId: segment.id,
          errorCode: 'E_TRANSLATE_SEGMENT',
          errorMessage: message,
          retryable: classifyError('E_TRANSLATE_SEGMENT', message) === 'retryable',
        })
        failedSegmentErrors.push(
          `#${segment.segmentIndex + 1}:${message}`,
        )
        if (this.isMiniMaxMissingContentError(message)) {
          throw new Error(
            `MiniMax returned empty content (1008) on segment #${segment.segmentIndex + 1}. Stop early to avoid cascading failures; retry later.`,
          )
        }
        continue
      }

      this.deps.taskSegmentDao.markSegmentSuccess(segment.id, {
        targetText: translatedText,
      })
      this.checkpointStore.saveSegmentCheckpoint({
        taskId: context.taskId,
        stageName: 'translating',
        checkpointSegmentId: segment.id,
        configSnapshot: this.buildCheckpointConfig(context.taskId),
      })
      completed += 1
      this.emit('segmentProgress', {
        taskId: context.taskId,
        stage: 'translating',
        segmentId: segment.id,
        index: segment.segmentIndex + 1,
        total,
        percent: Math.round((completed / Math.max(1, total)) * 100),
        message: `translated ${segment.segmentIndex + 1}/${total}`,
      })
    }

    const latestSegments = this.deps.taskSegmentDao.listByTaskAndStage(context.taskId, 'translating')
    const failed = latestSegments.filter((segment) => segment.status === 'failed')
    if (failed.length > 0) {
      const failedExcerpt = failedSegmentErrors.slice(0, 3).join(' | ')
      throw new Error(
        failedExcerpt
          ? `Translating has ${failed.length} failed segments. ${failedExcerpt}`
          : `Translating has ${failed.length} failed segments`,
      )
    }

    const ordered = this.assertStageSegmentIntegrity('translating', latestSegments, segments)
    const missing = ordered.find((segment) => !segment.targetText?.trim())
    if (missing) {
      throw new Error(`Segment missing translated text: ${missing.id}`)
    }

    let translated = ordered.map((segment) => segment.targetText ?? '').join('\n')
    const estimatedLongByDuration =
      typeof context.audioDurationSec === 'number' &&
      Number.isFinite(context.audioDurationSec) &&
      context.audioDurationSec >= polishConfig.minDurationSec
    const estimatedLongBySegmentCount = ordered.length >= 120
    if (polishConfig.autoPolishLongText && (estimatedLongByDuration || estimatedLongBySegmentCount)) {
      this.emit('log', {
        taskId: context.taskId,
        stage: 'translating',
        level: 'info',
        text: `Auto polishing enabled for long content (segments=${ordered.length}, durationSec=${
          context.audioDurationSec ?? 'unknown'
        })`,
        timestamp: new Date().toISOString(),
      })
      translated = await this.polishTranslationText({
        taskId: context.taskId,
        targetLanguage: task.targetLanguage,
        settings,
        text: translated,
        contextChars: polishConfig.contextChars,
        targetSegmentLength: polishConfig.targetSegmentLength,
        requestTimeoutMs: translateRequestTimeoutMs,
      })
    }

    const translationPath = this.buildUniqueFilePath(context.taskDir, 'translation-text', 'txt')
    await fs.writeFile(translationPath, translated, 'utf-8')
    context.translationPath = translationPath
    const translatedSegments = segment(translated, segmentation.strategy, segmentation.options)
    assertSegmentIntegrity(translated, translatedSegments)
    context.translationSegments = translatedSegments

    this.deps.artifactDao.addArtifact({
      taskId: context.taskId,
      artifactType: 'translation',
      filePath: translationPath,
      mimeType: 'text/plain',
    })
  }

  private async executeSynthesizing(context: TaskExecutionContext): Promise<void> {
    if (!context.translationPath) throw new Error('translationPath is missing')
    if (!context.toolchain) throw new Error('toolchain is not ready')
    const settings = this.resolveExecutionSettings(context.taskId)
    const translationText = await fs.readFile(context.translationPath, 'utf-8')
    const segmentation = this.resolveSegmentationConfig(context.taskId)

    const baseSegments =
      context.translationSegments && context.translationSegments.length > 0
        ? context.translationSegments
        : segment(translationText, segmentation.strategy, segmentation.options)
    assertSegmentIntegrity(translationText, baseSegments)

    const stageSegments = await this.ensureStageSegments(context.taskId, 'synthesizing', baseSegments)
    const retrySet = this.resolveRetrySet(context.taskId)
    const total = stageSegments.length
    let completed = stageSegments.filter((segment) => segment.status === 'success').length
    const maxAttempts = Math.max(1, settings.retryPolicy.tts + 1)
    const segmentDir = path.join(context.taskDir, this.buildUniqueName('tts-segments'))
    await fs.mkdir(segmentDir, { recursive: true })

    const runnableSegments = stageSegments.filter((segment) => {
      if (segment.status === 'success' && (!retrySet || !retrySet.has(segment.id))) return false
      if (retrySet && !retrySet.has(segment.id)) return false
      return true
    })
    const mutableErrors: string[] = []
    const concurrency = this.resolveTtsConcurrency(context.taskId, runnableSegments.length)
    this.emit('log', {
      taskId: context.taskId,
      stage: 'synthesizing',
      level: 'info',
      text: `Segment TTS orchestrator concurrency=${concurrency}, runnable=${runnableSegments.length}, total=${total}`,
      timestamp: new Date().toISOString(),
    })

    const synthTasks = runnableSegments.map((segment) => async () => {
      this.deps.taskSegmentDao.markSegmentRunning(segment.id)
      let outputPath: string | null = null
      let lastError: unknown = null

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const synth = await minimaxSynthesize({
            settings,
            text: segment.sourceText ?? '',
          })
          const targetPath = this.buildUniqueFilePath(
            segmentDir,
            `tts-segment-${segment.segmentIndex.toString().padStart(4, '0')}`,
            'mp3',
          )
          await downloadToFile(synth.downloadUrl, targetPath)
          outputPath = targetPath
          break
        } catch (error) {
          lastError = error
          const message = error instanceof Error ? error.message : String(error)
          const kind = classifyError('E_TTS_SEGMENT', message)
          if (kind !== 'retryable' || attempt >= maxAttempts) {
            break
          }
          await sleep(Math.min(4_000, 1000 * (2 ** (attempt - 1))))
        }
      }

      if (!outputPath) {
        const message = lastError instanceof Error ? lastError.message : 'Unknown synthesize segment error'
        this.deps.taskSegmentDao.markSegmentFailed(segment.id, {
          errorCode: 'E_TTS_SEGMENT',
          errorMessage: message,
          incrementRetry: true,
        })
        this.emit('segmentFailed', {
          taskId: context.taskId,
          stage: 'synthesizing',
          segmentId: segment.id,
          errorCode: 'E_TTS_SEGMENT',
          errorMessage: message,
          retryable: classifyError('E_TTS_SEGMENT', message) === 'retryable',
        })
        mutableErrors.push(`#${segment.segmentIndex + 1}:${message}`)
        return
      }

      this.deps.taskSegmentDao.markSegmentSuccess(segment.id, {
        targetText: outputPath,
      })
      this.checkpointStore.saveSegmentCheckpoint({
        taskId: context.taskId,
        stageName: 'synthesizing',
        checkpointSegmentId: segment.id,
        configSnapshot: this.buildCheckpointConfig(context.taskId),
      })

      completed += 1
      this.emit('segmentProgress', {
        taskId: context.taskId,
        stage: 'synthesizing',
        segmentId: segment.id,
        index: segment.segmentIndex + 1,
        total,
        percent: Math.round((completed / Math.max(1, total)) * 100),
        message: `synthesized ${segment.segmentIndex + 1}/${total}`,
      })
    })

    await runWithConcurrency(synthTasks, concurrency)

    if (mutableErrors.length > 0) {
      const failedExcerpt = mutableErrors.slice(0, 3).join(' | ')
      throw new Error(
        failedExcerpt
          ? `Synthesizing has ${mutableErrors.length} failed segments. ${failedExcerpt}`
          : `Synthesizing has ${mutableErrors.length} failed segments`,
      )
    }

    const latestSegments = this.deps.taskSegmentDao.listByTaskAndStage(context.taskId, 'synthesizing')
    const ordered = this.assertStageSegmentIntegrity('synthesizing', latestSegments, baseSegments)
    const failed = ordered.filter((segment) => segment.status !== 'success')
    if (failed.length > 0) {
      throw new Error(`Synthesizing has ${failed.length} incomplete segments`)
    }
    const missing = ordered.find((segment) => !segment.targetText)
    if (missing) {
      throw new Error(`Segment missing synthesized file: ${missing.id}`)
    }

    const concatListPath = this.buildUniqueFilePath(segmentDir, 'tts-concat-list', 'txt')
    const concatBody = ordered
      .map((segment) => `file '${(segment.targetText ?? '').replace(/'/g, `'\\''`)}'`)
      .join('\n')
    await fs.writeFile(concatListPath, concatBody, 'utf-8')

    const ttsRawPath = this.buildUniqueFilePath(context.taskDir, 'tts-raw-audio', 'mp3')
    try {
      await runCommand({
        command: context.toolchain.ffmpegPath,
        args: ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', ttsRawPath],
        cwd: context.taskDir,
        isCanceled: () => this.cancelRequested.has(context.taskId),
      })
    } catch {
      await runCommand({
        command: context.toolchain.ffmpegPath,
        args: ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c:a', 'libmp3lame', '-b:a', '128k', ttsRawPath],
        cwd: context.taskDir,
        isCanceled: () => this.cancelRequested.has(context.taskId),
      })
    }

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
    const finalPath = this.buildUniqueFilePath(context.taskDir, 'tts-final-audio', 'mp3')
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
