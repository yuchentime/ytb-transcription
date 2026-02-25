import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
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
} from '../db/types'
import { runCommand } from './command'
import { synthesizeSpeech, translateText } from './modelProvider'
import { CheckpointStore } from './recovery/CheckpointStore'
import { RecoveryPlanner, classifyError } from './recovery/RecoveryPlanner'
import { assertSegmentIntegrity, segment, type TextSegment } from './segmentation'
import { ensureToolchain } from './toolchain'
import { runWithConcurrency } from '../../services/minimax/ttsAsyncOrchestrator'
import {
  DEFAULT_POLISH_CONTEXT_CHARS,
  DEFAULT_POLISH_MIN_DURATION_SEC,
  DEFAULT_POLISH_TARGET_SEGMENT_LENGTH,
  DEFAULT_TRANSCRIBE_CHUNK_DURATION_SEC,
  DEFAULT_TRANSCRIBE_CHUNK_ENABLED,
  DEFAULT_TRANSCRIBE_CHUNK_MIN_DURATION_SEC,
  DEFAULT_TRANSCRIBE_CHUNK_OVERLAP_SEC,
  DEFAULT_TRANSCRIBE_CONCURRENCY,
  DEFAULT_TRANSLATE_REQUEST_TIMEOUT_MS,
  DEFAULT_TRANSLATE_SPLIT_THRESHOLD_TOKENS,
  DEFAULT_TRANSLATE_CONTEXT_WINDOW_TOKENS,
  DEFAULT_TRANSLATION_CONTEXT_CHARS,
  DEFAULT_TTS_SPLIT_THRESHOLD_CHARS,
  DEFAULT_TTS_TARGET_SEGMENT_CHARS,
  GLM_TTS_MAX_INPUT_CHARS,
  QWEN_TTS_MAX_INPUT_CHARS,
  QWEN_TTS_MAX_INPUT_UTF8_BYTES,
  QWEN_TTS_MAX_INPUT_TOKENS,
  MLX_MODEL_REPOS,
  STAGES,
  WHISPER_MODEL_URLS,
} from './constants'
import type { EventName, Listener, TaskEngineEvents, TaskExecutionContext } from './types'
import {
  buildSegmentsFromChunkTexts,
  estimateTokenCount,
  joinTranslatedChunks,
  mergeChunkTranscript,
  resolveDominantLanguage,
  splitTextByHardLimit,
  splitTextByPunctuationForTts,
  splitTextByTokenBudget,
  trimContextWindow,
} from './text-processing'
import {
  buildComparableCheckpointConfig,
  normalizeEndpointForLog,
  resolveTranslateApiBaseUrl,
  resolveTranslateApiKeyState,
  resolveTtsApiBaseUrl,
  resolveTtsApiKeyState,
} from './settings-resolvers'
import {
  canResumeAtStage,
  computeSha256,
  downloadFileStream,
  downloadToFile,
  formatComparableValue,
  hasProxyEnv,
  isLikelyProxyTlsError,
  isRecord,
  isSegmentStage,
  normalizeCheckpointStageName,
  parseDownloadSpeed,
  parseDurationFromLine,
  parseFailedSegmentIds,
  parsePercent,
  parseWhisperDetectedLanguage,
  parseWhisperModelHashFromUrl,
  selectTranscribeBackend,
  selectWhisperDevice,
  shouldRetryWithTvClient,
  sleep,
  stageToStatus,
  toSafeNumber,
  type ArtifactTypeForResume,
} from './utils'


/**
 * Orchestrates the end-to-end task pipeline, including stage execution, retries,
 * checkpoints, resume decisions, and runtime event emission.
 */
export class TaskEngine {
  private readonly emitter = new EventEmitter()
  private runningTaskId: string | null = null
  private readonly cancelRequested = new Set<string>()
  private readonly retrySegmentRequests = new Map<string, Set<string>>()
  private readonly resumeFromStageRequests = new Map<string, StepName>()
  private readonly checkpointStore: CheckpointStore
  private readonly recoveryPlanner: RecoveryPlanner

  /** Initialize TaskEngine with DAO dependencies and recovery helpers. */
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

  /** Register a typed runtime event listener and return an unsubscribe callback. */
  on<T extends EventName>(event: T, listener: Listener<T>): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return () => {
      this.emitter.off(event, listener as (...args: unknown[]) => void)
    }
  }

  /** Build a collision-resistant artifact base name. */
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

  /** Build a unique file path under a task directory with normalized extension. */
  private buildUniqueFilePath(taskDir: string, prefix: string, extension: string): string {
    const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`
    return path.join(taskDir, `${this.buildUniqueName(prefix)}${normalizedExtension}`)
  }

  /** Queue and start task execution if no conflicting task is currently running. */
  start(taskId: string): { accepted: boolean; reason?: string } {
    if (this.runningTaskId && this.runningTaskId !== taskId) {
      return { accepted: false, reason: `Task ${this.runningTaskId} is already running` }
    }

    this.deps.taskDao.getTaskById(taskId)
    if (this.runningTaskId === taskId) {
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

  /** Retry a task by reusing the same start flow and validations. */
  retry(taskId: string): { accepted: boolean; reason?: string } {
    return this.start(taskId)
  }

  /** Return the current running task id, if any. */
  getRunningTaskId(): string | null {
    return this.runningTaskId
  }

  /** List all persisted segments that belong to a task. */
  listSegments(taskId: string): TaskSegmentRecord[] {
    return this.deps.taskSegmentDao.listByTask(taskId)
  }

  /** Build a recovery plan based on current task and segment state. */
  getRecoveryPlan(taskId: string): RecoveryPlan {
    return this.recoveryPlanner.createPlan(taskId)
  }

  /** Schedule partial rerun for selected segments and start the task. */
  retrySegments(taskId: string, segmentIds: string[]): { accepted: boolean; reason?: string } {
    const prepared = this.prepareRetrySegments(taskId, segmentIds)
    if (!prepared.accepted) {
      return prepared
    }

    const started = this.start(taskId)
    if (!started.accepted) {
      this.clearPendingExecutionRequests(taskId)
    }
    return started
  }

  /** Validate and record pending segment retry requests before task start. */
  prepareRetrySegments(taskId: string, segmentIds: string[]): { accepted: boolean; reason?: string } {
    if (!Array.isArray(segmentIds) || segmentIds.length === 0) {
      return { accepted: false, reason: 'segmentIds is required' }
    }
    if (this.runningTaskId === taskId) {
      return { accepted: false, reason: 'Task is already running' }
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
    return { accepted: true }
  }

  /** Resume a task from checkpoint metadata and immediately start execution. */
  resumeFromCheckpoint(taskId: string): { accepted: boolean; fromStage: string; reason?: string } {
    const prepared = this.prepareResumeFromCheckpoint(taskId)
    if (!prepared.accepted) {
      return prepared
    }

    const started = this.start(taskId)
    if (!started.accepted) {
      this.clearPendingExecutionRequests(taskId)
    }
    return {
      accepted: started.accepted,
      fromStage: prepared.fromStage,
      reason: started.reason,
    }
  }

  /** Resolve resume stage and retry set from checkpoint or artifact fallback. */
  prepareResumeFromCheckpoint(taskId: string): { accepted: boolean; fromStage: string; reason?: string } {
    if (this.runningTaskId === taskId) {
      return { accepted: false, fromStage: 'downloading', reason: 'Task is already running' }
    }

    const snapshot = this.deps.taskRecoveryDao.getLatestSnapshot(taskId)
    if (!snapshot) {
      const fallbackStage = this.resolveFallbackResumeStage(taskId)
      const retrySet = this.resolveResumeRetrySet(taskId, fallbackStage, [])
      if (retrySet.size > 0) {
        this.retrySegmentRequests.set(taskId, retrySet)
      } else {
        this.retrySegmentRequests.delete(taskId)
      }
      this.resumeFromStageRequests.set(taskId, fallbackStage)
      return {
        accepted: true,
        fromStage: fallbackStage,
      }
    }

    const stageName = this.resolveCheckpointStage(snapshot.stageName, snapshot.snapshotJson)
    if (!stageName) {
      return { accepted: false, fromStage: snapshot.stageName, reason: 'Checkpoint stage is invalid' }
    }

    const shouldResetSynthesis = this.shouldResetSynthesisProgress(
      taskId,
      stageName,
      snapshot.snapshotJson.configSnapshot,
    )
    if (shouldResetSynthesis) {
      this.deps.taskSegmentDao.clearByTaskAndStage(taskId, 'synthesizing')
      this.retrySegmentRequests.delete(taskId)
      this.resumeFromStageRequests.set(taskId, 'synthesizing')
      this.emit('log', {
        taskId,
        stage: 'engine',
        level: 'info',
        text: 'Detected TTS config changes while resuming synthesis; restarting synthesizing stage to avoid mixed voices',
        timestamp: new Date().toISOString(),
      })
      return {
        accepted: true,
        fromStage: 'synthesizing',
      }
    }

    const retrySet = this.resolveResumeRetrySet(taskId, stageName, snapshot.snapshotJson.failedSegmentIds)
    if (retrySet.size > 0) {
      this.retrySegmentRequests.set(taskId, retrySet)
    } else {
      this.retrySegmentRequests.delete(taskId)
    }
    this.resumeFromStageRequests.set(taskId, stageName)

    return {
      accepted: true,
      fromStage: stageName,
    }
  }

  /** Clear cached resume and retry requests for the specified task. */
  clearPendingExecutionRequests(taskId: string): void {
    this.retrySegmentRequests.delete(taskId)
    this.resumeFromStageRequests.delete(taskId)
  }

  /** Request cancellation for queued/running tasks and persist canceled status. */
  cancel(taskId: string): { canceled: boolean } {
    const task = this.deps.taskDao.getTaskById(taskId)
    if (task.status === 'queued' && this.runningTaskId !== taskId) {
      this.markCanceled(taskId)
      return { canceled: true }
    }
    if (this.runningTaskId === taskId) {
      this.cancelRequested.add(taskId)
      this.markCanceled(taskId)
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

  /** Execute the full stage pipeline and finalize task state. */
  private async runTask(taskId: string): Promise<void> {
    const context: TaskExecutionContext = {
      taskId,
      taskDir: path.join(this.deps.artifactsRoot, taskId),
    }

    try {
      await fs.mkdir(context.taskDir, { recursive: true })
      this.hydrateContextFromArtifacts(context)
      await this.ensureResources(context)
      this.emitProviderResolutionLog(taskId)

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

  /** Recover known artifact paths into runtime context before stage execution. */
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

  /** Prepare required toolchain binaries and stream runtime readiness events. */
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

  /** Emit sanitized provider/model endpoint configuration logs for diagnostics. */
  private emitProviderResolutionLog(taskId: string): void {
    const settings = this.resolveExecutionSettings(taskId)
    const translateEndpoint = normalizeEndpointForLog(resolveTranslateApiBaseUrl(settings))
    const ttsEndpoint =
      settings.ttsProvider === 'piper'
        ? '(local-piper)'
        : normalizeEndpointForLog(resolveTtsApiBaseUrl(settings))
    this.emit('log', {
      taskId,
      stage: 'engine',
      level: 'info',
      text: `Resolved translation provider=${settings.translateProvider}, model=${settings.translateModelId || '(empty)'}, baseUrl=${translateEndpoint}, apiKey=${resolveTranslateApiKeyState(settings)}`,
      timestamp: new Date().toISOString(),
    })
    this.emit('log', {
      taskId,
      stage: 'engine',
      level: 'info',
      text: `Resolved tts provider=${settings.ttsProvider}, model=${settings.ttsModelId || '(empty)'}, baseUrl=${ttsEndpoint}, apiKey=${resolveTtsApiKeyState(settings)}`,
      timestamp: new Date().toISOString(),
    })
  }

  /** Run one stage with lifecycle bookkeeping, error handling, and cancellation. */
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

  /** Download source video with yt-dlp, including auth and fallback strategies. */
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
      '--print',
      'before_dl:__YTB_META_TITLE__%(title)s',
      '--print',
      'before_dl:__YTB_META_AUTHOR__%(uploader)s',
    ]
    let youtubeTitle = task.youtubeTitle?.trim() ?? ''
    let youtubeAuthor = task.youtubeAuthor?.trim() ?? ''
    const normalizeMetadataValue = (value: string): string | null => {
      const normalized = value.trim()
      if (!normalized || normalized.toLowerCase() === 'na') {
        return null
      }
      return normalized
    }
    const syncTaskMetadata = (patch: { youtubeTitle?: string | null; youtubeAuthor?: string | null }): void => {
      const nextTitle = patch.youtubeTitle !== undefined ? (patch.youtubeTitle ?? '') : youtubeTitle
      const nextAuthor = patch.youtubeAuthor !== undefined ? (patch.youtubeAuthor ?? '') : youtubeAuthor
      if (nextTitle === youtubeTitle && nextAuthor === youtubeAuthor) {
        return
      }
      this.deps.taskDao.updateTaskMetadata(context.taskId, {
        youtubeTitle: patch.youtubeTitle !== undefined ? nextTitle || null : undefined,
        youtubeAuthor: patch.youtubeAuthor !== undefined ? nextAuthor || null : undefined,
      })
      youtubeTitle = nextTitle
      youtubeAuthor = nextAuthor
    }
    const consumeMetadataLine = (line: string): boolean => {
      if (line.startsWith('__YTB_META_TITLE__')) {
        const parsed = normalizeMetadataValue(line.slice('__YTB_META_TITLE__'.length))
        syncTaskMetadata({ youtubeTitle: parsed })
        return true
      }
      if (line.startsWith('__YTB_META_AUTHOR__')) {
        const parsed = normalizeMetadataValue(line.slice('__YTB_META_AUTHOR__'.length))
        syncTaskMetadata({ youtubeAuthor: parsed })
        return true
      }
      return false
    }

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
      let lastSpeed = ''
      await runCommand({
        command: toolchain.ytDlpPath,
        args,
        cwd: context.taskDir,
        isCanceled: () => this.cancelRequested.has(context.taskId),
        onStdoutLine: (line) => {
          if (consumeMetadataLine(line)) {
            return
          }
          const percent = parsePercent(line)
          if (percent !== null) {
            // 解析下载速度
            const speed = parseDownloadSpeed(line)
            if (speed) {
              lastSpeed = speed
            }
            this.emit('progress', {
              taskId: context.taskId,
              stage: 'downloading',
              percent,
              message: line,
              speed: lastSpeed || undefined,
            })
          }
        },
        onStderrLine: (line) => {
          if (consumeMetadataLine(line)) {
            return
          }
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

  /** Extract mono 16k wav audio from downloaded video using ffmpeg. */
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

  /** Emit structured transcribing-stage log records. */
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

  /** Ensure whisper model assets exist locally and verify checksum when possible. */
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

  /** Resolve translation context window size from task snapshot with bounds. */
  private resolveTranslationContextChars(taskId: string): number {
    const task = this.deps.taskDao.getTaskById(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    return Math.floor(
      toSafeNumber(snapshot.translationContextChars, DEFAULT_TRANSLATION_CONTEXT_CHARS, 0, 500),
    )
  }

  /** Resolve per-request translation timeout from task snapshot with bounds. */
  private resolveTranslateRequestTimeoutMs(taskId: string): number {
    const task = this.deps.taskDao.getTaskById(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    return Math.floor(
      toSafeNumber(snapshot.translateRequestTimeoutMs, DEFAULT_TRANSLATE_REQUEST_TIMEOUT_MS, 15_000, 10 * 60 * 1000),
    )
  }

  /** Resolve token threshold used to split translation input into segments. */
  private resolveTranslateSplitThresholdTokens(taskId: string): number {
    const task = this.deps.taskDao.getTaskById(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    return Math.floor(
      toSafeNumber(
        snapshot.translateSplitThresholdTokens,
        DEFAULT_TRANSLATE_SPLIT_THRESHOLD_TOKENS,
        2_000,
        DEFAULT_TRANSLATE_CONTEXT_WINDOW_TOKENS,
      ),
    )
  }

  /** Resolve TTS text segmentation thresholds from task snapshot. */
  private resolveTtsSegmentationConfig(taskId: string): {
    splitThresholdChars: number
    targetSegmentChars: number
  } {
    const task = this.deps.taskDao.getTaskById(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    const segmentationOptions =
      snapshot.segmentationOptions && typeof snapshot.segmentationOptions === 'object'
        ? (snapshot.segmentationOptions as Record<string, unknown>)
        : {}
    const targetFromSegmentation =
      typeof segmentationOptions.maxCharsPerSegment === 'number'
        ? segmentationOptions.maxCharsPerSegment
        : typeof segmentationOptions.targetSegmentLength === 'number'
          ? segmentationOptions.targetSegmentLength
          : DEFAULT_TTS_TARGET_SEGMENT_CHARS
    return {
      splitThresholdChars: Math.floor(
        toSafeNumber(
          snapshot.ttsSplitThresholdChars,
          DEFAULT_TTS_SPLIT_THRESHOLD_CHARS,
          400,
          20_000,
        ),
      ),
      targetSegmentChars: Math.floor(
        toSafeNumber(
          snapshot.ttsTargetSegmentChars,
          targetFromSegmentation,
          120,
          3_000,
        ),
      ),
    }
  }

  /** Extract provider-specific missing-content code from error text. */
  private getMissingContentCode(errorMessage: string): string | null {
    const matched = errorMessage.match(/missing content\s*\(([^)]+)\)/i)
    if (!matched) return null
    return matched[1]?.trim() ?? null
  }

  /** Determine whether an error represents an empty-response provider failure. */
  private isMissingContentError(errorMessage: string): boolean {
    return this.getMissingContentCode(errorMessage) !== null
  }

  /** Determine whether translation failure indicates truncation or incomplete output. */
  private isTranslationIncompleteError(errorMessage: string): boolean {
    const normalized = errorMessage.trim().toLowerCase()
    if (!normalized) return false
    if (this.isMissingContentError(errorMessage)) return true
    return (
      normalized.includes('truncated') ||
      normalized.includes('finish_reason=length') ||
      normalized.includes('finish_reason=max_tokens') ||
      normalized.includes('translation appears incomplete') ||
      normalized.includes('untranslated')
    )
  }

  /** Validate translated content shape to block large untranslated carry-over for zh/ja. */
  private validateTranslatedSegment(params: {
    sourceText: string
    translatedText: string
    targetLanguage: string
  }): string | null {
    const normalizedSource = params.sourceText.trim()
    const normalizedTarget = params.translatedText.trim()
    if (!normalizedTarget) {
      return 'Translation appears incomplete: empty translated content'
    }
    if (normalizedSource.length < 220 || normalizedTarget.length < 180) {
      return null
    }

    const sourceAsciiCount = normalizedSource.match(/[A-Za-z]/g)?.length ?? 0
    const targetAsciiCount = normalizedTarget.match(/[A-Za-z]/g)?.length ?? 0
    const sourceAsciiRatio = sourceAsciiCount / Math.max(1, normalizedSource.length)
    const targetAsciiRatio = targetAsciiCount / Math.max(1, normalizedTarget.length)
    const targetLanguage = params.targetLanguage.trim().toLowerCase()

    const targetZhCount =
      normalizedTarget.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu)?.length ?? 0
    const targetJaCount =
      normalizedTarget.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu)?.length ??
      0

    const hasLongLatinRun =
      /[A-Za-z][A-Za-z\s,.;:!?'"()-]{120,}/.test(normalizedTarget) && sourceAsciiRatio >= 0.4
    if (targetLanguage === 'zh') {
      const targetZhRatio = targetZhCount / Math.max(1, normalizedTarget.length)
      if (
        hasLongLatinRun ||
        (sourceAsciiCount >= 80 && sourceAsciiRatio >= 0.4 && targetZhRatio < 0.18 && targetAsciiRatio > 0.55)
      ) {
        return 'Translation appears incomplete: output still contains large untranslated source text'
      }
    }
    if (targetLanguage === 'ja') {
      const targetJaRatio = targetJaCount / Math.max(1, normalizedTarget.length)
      if (
        hasLongLatinRun ||
        (sourceAsciiCount >= 80 && sourceAsciiRatio >= 0.4 && targetJaRatio < 0.12 && targetAsciiRatio > 0.6)
      ) {
        return 'Translation appears incomplete: output still contains large untranslated source text'
      }
    }

    return null
  }

  /** Decide if translation text must be split by token budget. */
  private shouldSplitTranslationByContextWindow(sourceText: string, splitThresholdTokens: number): boolean {
    return estimateTokenCount(sourceText) > splitThresholdTokens
  }

  /** Build translation segments using token-aware chunking when needed. */
  private buildTranslationSegments(params: {
    sourceText: string
    splitThresholdTokens: number
  }): TextSegment[] {
    const normalized = params.sourceText.trim()
    if (!normalized) return []
    if (!this.shouldSplitTranslationByContextWindow(normalized, params.splitThresholdTokens)) {
      return buildSegmentsFromChunkTexts([normalized])
    }
    const chunkTexts = splitTextByTokenBudget(normalized, params.splitThresholdTokens)
    return buildSegmentsFromChunkTexts(chunkTexts)
  }

  /** Build TTS segments optimized for provider limits and punctuation boundaries. */
  private buildTtsSegments(params: {
    sourceText: string
    splitThresholdChars: number
    targetSegmentChars: number
  }): TextSegment[] {
    const normalized = params.sourceText.trim()
    if (!normalized) return []
    if (normalized.length <= params.splitThresholdChars) {
      return buildSegmentsFromChunkTexts([normalized])
    }
    const chunkTexts = splitTextByPunctuationForTts(normalized, params.targetSegmentChars)
    if (chunkTexts.length <= 1) {
      return buildSegmentsFromChunkTexts([normalized])
    }
    return buildSegmentsFromChunkTexts(chunkTexts)
  }

  /** Determine whether current Qwen TTS model follows token-based input limits. */
  private isQwenTokenLimitedModel(modelId: string): boolean {
    const normalized = modelId.trim().toLowerCase()
    if (!normalized) return false
    return /^qwen\d*-tts/.test(normalized) || normalized.includes('qwen-tts')
  }

  /** Split text into sentence-level units using sentence-ending punctuation only. */
  private splitTextBySentenceEndings(text: string): string[] {
    const normalized = text.replace(/\r\n/g, '\n').trim()
    if (!normalized) return []
    const matched = normalized.match(/[^。！？!?;.\n]+(?:[。！？!?;.]+|\n+|$)/g)
    if (!matched) return [normalized]
    return matched.map((item) => item.replace(/\s+$/g, '')).filter((item) => item.trim().length > 0)
  }

  /** Split text by UTF-8 byte limit while preserving character boundaries. */
  private splitTextByUtf8ByteLimit(text: string, maxBytes: number): string[] {
    const normalized = text.trim()
    if (!normalized) return []
    if (maxBytes <= 0 || Buffer.byteLength(normalized, 'utf8') <= maxBytes) {
      return [normalized]
    }

    const chunks: string[] = []
    let buffer = ''
    for (const char of normalized) {
      const next = `${buffer}${char}`
      if (buffer && Buffer.byteLength(next, 'utf8') > maxBytes) {
        const trimmed = buffer.trim()
        if (trimmed) chunks.push(trimmed)
        buffer = char
        continue
      }
      buffer = next
    }
    if (buffer.trim()) {
      chunks.push(buffer.trim())
    }
    return chunks
  }

  /** Build Qwen TTS segments with sentence boundaries and model hard limits. */
  private buildQwenTtsSegments(params: {
    sourceText: string
    modelId: string
    targetSegmentChars: number
  }): TextSegment[] {
    const normalized = params.sourceText.trim()
    if (!normalized) return []

    const tokenLimitedModel = this.isQwenTokenLimitedModel(params.modelId)
    const tokenLimit = tokenLimitedModel ? QWEN_TTS_MAX_INPUT_TOKENS : null
    const hardCharLimit = QWEN_TTS_MAX_INPUT_CHARS
    const hardByteLimit = QWEN_TTS_MAX_INPUT_UTF8_BYTES
    const softTarget = Math.max(120, Math.min(params.targetSegmentChars, hardCharLimit))
    const sentenceUnits = this.splitTextBySentenceEndings(normalized)

    const meetsHardLimits = (text: string): boolean => {
      const candidate = text.trim()
      if (!candidate) return false
      if (candidate.length > hardCharLimit) return false
      if (Buffer.byteLength(candidate, 'utf8') > hardByteLimit) return false
      if (tokenLimit !== null && estimateTokenCount(candidate) > tokenLimit) return false
      return true
    }

    const splitOverlongUnit = (text: string): string[] => {
      const tokenScoped = tokenLimit !== null ? splitTextByTokenBudget(text, tokenLimit) : [text]
      const charScoped = tokenScoped.flatMap((item) => splitTextByHardLimit(item, hardCharLimit))
      const byteScoped = charScoped.flatMap((item) => this.splitTextByUtf8ByteLimit(item, hardByteLimit))
      return byteScoped.map((item) => item.trim()).filter(Boolean)
    }

    const chunks: string[] = []
    let buffer = ''
    for (const unitRaw of sentenceUnits) {
      const unit = unitRaw.replace(/\s+$/g, '')
      if (!unit.trim()) continue

      if (!buffer) {
        if (meetsHardLimits(unit)) {
          buffer = unit
          continue
        }
        chunks.push(...splitOverlongUnit(unit))
        continue
      }

      const merged = `${buffer}${unit}`
      const mergedWithinHardLimit = meetsHardLimits(merged)
      const mergedWithinTarget = merged.length <= softTarget
      if (mergedWithinHardLimit && mergedWithinTarget) {
        buffer = merged
        continue
      }

      chunks.push(buffer.trim())
      if (meetsHardLimits(unit)) {
        buffer = unit
      } else {
        chunks.push(...splitOverlongUnit(unit))
        buffer = ''
      }
    }

    if (buffer.trim()) {
      chunks.push(buffer.trim())
    }

    if (chunks.length <= 1 && meetsHardLimits(normalized)) {
      return buildSegmentsFromChunkTexts([normalized])
    }
    return buildSegmentsFromChunkTexts(chunks)
  }

  /** Build GLM TTS segments with sentence boundaries and 1024-char hard limit. */
  private buildGlmTtsSegments(params: {
    sourceText: string
    targetSegmentChars: number
  }): TextSegment[] {
    const normalized = params.sourceText.trim()
    if (!normalized) return []

    const hardCharLimit = GLM_TTS_MAX_INPUT_CHARS
    const softTarget = Math.max(120, Math.min(params.targetSegmentChars, hardCharLimit))
    const sentenceUnits = this.splitTextBySentenceEndings(normalized)
    const meetsHardLimits = (text: string): boolean => text.trim().length > 0 && text.trim().length <= hardCharLimit
    const splitOverlongUnit = (text: string): string[] =>
      splitTextByHardLimit(text, hardCharLimit).map((item) => item.trim()).filter(Boolean)

    const chunks: string[] = []
    let buffer = ''
    for (const unitRaw of sentenceUnits) {
      const unit = unitRaw.replace(/\s+$/g, '')
      if (!unit.trim()) continue

      if (!buffer) {
        if (meetsHardLimits(unit)) {
          buffer = unit
          continue
        }
        chunks.push(...splitOverlongUnit(unit))
        continue
      }

      const merged = `${buffer}${unit}`
      const mergedWithinHardLimit = meetsHardLimits(merged)
      const mergedWithinTarget = merged.length <= softTarget
      if (mergedWithinHardLimit && mergedWithinTarget) {
        buffer = merged
        continue
      }

      chunks.push(buffer.trim())
      if (meetsHardLimits(unit)) {
        buffer = unit
      } else {
        chunks.push(...splitOverlongUnit(unit))
        buffer = ''
      }
    }

    if (buffer.trim()) {
      chunks.push(buffer.trim())
    }
    if (chunks.length <= 1 && meetsHardLimits(normalized)) {
      return buildSegmentsFromChunkTexts([normalized])
    }
    return buildSegmentsFromChunkTexts(chunks)
  }

  /** Resolve optional translation polishing behavior for long content. */
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

  /** Resolve chunked transcription config and safety limits. */
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

  /** Resolve safe transcription concurrency based on backend/device constraints. */
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

  /** Build time ranges for chunked audio transcription with overlap. */
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

  /** Probe audio duration by parsing ffmpeg metadata output. */
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


  /** Transcribe audio with backend fallback, retries, and optional chunk mode. */
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

    const transcribePythonEnvBase: NodeJS.ProcessEnv = {
      XDG_CACHE_HOME: path.join(this.deps.dataRoot, 'cache'),
    }
    if (path.isAbsolute(toolchain.ffmpegPath)) {
      const ffmpegDir = path.dirname(toolchain.ffmpegPath)
      const inheritedPath = process.env.PATH ?? ''
      transcribePythonEnvBase.PATH = inheritedPath
        ? `${ffmpegDir}${path.delimiter}${inheritedPath}`
        : ffmpegDir
      transcribePythonEnvBase.FFMPEG_BINARY = toolchain.ffmpegPath
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
        'from huggingface_hub import snapshot_download',
        `audio = ${JSON.stringify(audioPath)}`,
        `repo = ${JSON.stringify(repo)}`,
        `language = ${task.sourceLanguage ? JSON.stringify(task.sourceLanguage) : 'None'}`,
        'try:',
        '    model_ref = snapshot_download(repo_id=repo, local_files_only=True)',
        'except Exception:',
        '    model_ref = snapshot_download(repo_id=repo)',
        'kwargs = {"path_or_hf_repo": model_ref}',
        'if language:',
        '    kwargs["language"] = language',
        'result = mlx_whisper.transcribe(audio, **kwargs)',
        `txt_path = pathlib.Path(${JSON.stringify(outputTxtPath)})`,
        `json_path = pathlib.Path(${JSON.stringify(outputJsonPath)})`,
        'txt_path.write_text(result.get("text", ""), encoding="utf-8")',
        'json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")',
      ]

      const runMlxCommand = async (disableProxy: boolean): Promise<string[]> => {
        const stderrLines: string[] = []
        const env: NodeJS.ProcessEnv = {
          ...transcribePythonEnvBase,
          XDG_CACHE_HOME: path.join(this.deps.dataRoot, 'cache'),
          HF_HOME: path.join(this.deps.dataRoot, 'cache', 'hf'),
          HF_HUB_DISABLE_IMPLICIT_TOKEN: '1',
          HF_TOKEN: '',
          HUGGINGFACE_HUB_TOKEN: '',
          HUGGING_FACE_HUB_TOKEN: '',
        }
        if (disableProxy) {
          env.HTTP_PROXY = ''
          env.HTTPS_PROXY = ''
          env.ALL_PROXY = ''
          env.http_proxy = ''
          env.https_proxy = ''
          env.all_proxy = ''
          env.NO_PROXY = '*'
          env.no_proxy = '*'
        }

        try {
          await runCommand({
            command: toolchain.pythonPath,
            args: ['-c', scriptLines.join('\n')],
            cwd: context.taskDir,
            timeoutMs: settings.stageTimeoutMs,
            env,
            isCanceled: () => this.cancelRequested.has(context.taskId),
            onStderrLine: (line) => {
              stderrLines.push(line)
              this.emit('log', {
                taskId: context.taskId,
                stage: 'transcribing',
                level: 'info',
                text: line,
                timestamp: new Date().toISOString(),
              })
            },
          })
        } catch (error) {
          if (error instanceof Error) {
            const errorWithStderr = error as Error & { stderrLines?: string[] }
            errorWithStderr.stderrLines = stderrLines
            throw error
          }
          const wrapped = new Error(String(error))
          const wrappedWithStderr = wrapped as Error & { stderrLines?: string[] }
          wrappedWithStderr.stderrLines = stderrLines
          throw wrapped
        }
        return stderrLines
      }

      try {
        await runMlxCommand(false)
      } catch (error) {
        const stderrLines =
          error instanceof Error &&
          Array.isArray((error as Error & { stderrLines?: unknown }).stderrLines)
            ? ((error as Error & { stderrLines?: string[] }).stderrLines ?? [])
            : []
        if (hasProxyEnv() && isLikelyProxyTlsError(stderrLines)) {
          this.emit('log', {
            taskId: context.taskId,
            stage: 'transcribing',
            level: 'warn',
            text: 'MLX download hit proxy TLS error, retrying once without proxy env',
            timestamp: new Date().toISOString(),
          })
          await runMlxCommand(true)
          return
        }
        throw error
      }
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

      const stderrLines: string[] = []
      await runCommand({
        command: toolchain.pythonPath,
        args,
        cwd: context.taskDir,
        timeoutMs: settings.stageTimeoutMs,
        env: transcribePythonEnvBase,
        isCanceled: () => this.cancelRequested.has(context.taskId),
        onStderrLine: (line) => {
          stderrLines.push(line)
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
      const whisperTxtPath = path.join(outputDir, `${baseName}.txt`)
      const whisperJsonPath = path.join(outputDir, `${baseName}.json`)
      try {
        await fs.access(whisperTxtPath)
        await fs.access(whisperJsonPath)
      } catch {
        const detail = stderrLines.slice(-12).join(' | ')
        throw new Error(
          detail
            ? `Whisper finished but output files were not produced (${whisperTxtPath}, ${whisperJsonPath}). stderr: ${detail}`
            : `Whisper finished but output files were not produced (${whisperTxtPath}, ${whisperJsonPath})`,
        )
      }

      return {
        whisperTxtPath,
        whisperJsonPath,
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
        try {
          await fs.access(generated.whisperTxtPath)
          await fs.access(generated.whisperJsonPath)
        } catch {
          throw new Error(
            `Whisper output files are missing: txt=${generated.whisperTxtPath}, json=${generated.whisperJsonPath}`,
          )
        }
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

  /** Resolve text segmentation strategy used after translation. */
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

  /** Get pending segment retry ids for the current task execution. */
  private resolveRetrySet(taskId: string): Set<string> | null {
    return this.retrySegmentRequests.get(taskId) ?? null
  }

  /** Create or reuse stage segment records while ensuring source shape consistency. */
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

  /** Build comparable checkpoint configuration snapshot for recovery decisions. */
  private buildCheckpointConfig(taskId: string): Record<string, unknown> {
    const task = this.deps.taskDao.getTaskById(taskId)
    const settings = this.resolveExecutionSettings(taskId)
    const segmentation = this.resolveSegmentationConfig(taskId)
    const polish = this.resolvePolishConfig(taskId)
    const transcribeChunk = this.resolveTranscribeChunkConfig(taskId)
    const ttsSegmentation = this.resolveTtsSegmentationConfig(taskId)
    const translationContextChars = this.resolveTranslationContextChars(taskId)
    const translateRequestTimeoutMs = this.resolveTranslateRequestTimeoutMs(taskId)
    const translateSplitThresholdTokens = this.resolveTranslateSplitThresholdTokens(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    const ttsPollingConcurrency =
      typeof snapshot.ttsPollingConcurrency === 'number' && Number.isFinite(snapshot.ttsPollingConcurrency)
        ? Math.floor(snapshot.ttsPollingConcurrency)
        : undefined

    return {
      targetLanguage: task.targetLanguage,
      segmentationStrategy: segmentation.strategy,
      segmentationOptions: segmentation.options,
      translateProvider: settings.translateProvider,
      ttsProvider: settings.ttsProvider,
      translateApiBaseUrl: resolveTranslateApiBaseUrl(settings),
      ttsApiBaseUrl: resolveTtsApiBaseUrl(settings),
      translateModelId: settings.translateModelId,
      ttsModelId: settings.ttsModelId,
      ttsVoiceId: settings.ttsVoiceId,
      ttsSpeed: settings.ttsSpeed,
      ttsPitch: settings.ttsPitch,
      ttsVolume: settings.ttsVolume,
      piperExecutablePath: settings.piperExecutablePath,
      piperModelPath: settings.piperModelPath,
      piperConfigPath: settings.piperConfigPath,
      piperSpeakerId: settings.piperSpeakerId,
      piperLengthScale: settings.piperLengthScale,
      piperNoiseScale: settings.piperNoiseScale,
      piperNoiseW: settings.piperNoiseW,
      ttsPollingConcurrency,
      translationContextChars,
      translateRequestTimeoutMs,
      translateSplitThresholdTokens,
      autoPolishLongText: polish.autoPolishLongText,
      polishMinDurationSec: polish.minDurationSec,
      polishContextChars: polish.contextChars,
      polishTargetSegmentLength: polish.targetSegmentLength,
      transcribeChunkEnabled: transcribeChunk.enabled,
      transcribeChunkMinDurationSec: transcribeChunk.minDurationSec,
      transcribeChunkDurationSec: transcribeChunk.chunkDurationSec,
      transcribeChunkOverlapSec: transcribeChunk.overlapSec,
      ttsSplitThresholdChars: ttsSegmentation.splitThresholdChars,
      ttsTargetSegmentChars: ttsSegmentation.targetSegmentChars,
    }
  }

  /** Normalize checkpoint stage name from either column or snapshot payload. */
  private resolveCheckpointStage(
    stageName: string,
    snapshotJson: Record<string, unknown>,
  ): StepName | null {
    const fromStageColumn = normalizeCheckpointStageName(stageName)
    if (fromStageColumn) return fromStageColumn
    return normalizeCheckpointStageName(snapshotJson.stageName)
  }

  /** Compare checkpoint config keys against current runtime config. */
  private listCheckpointConfigMismatches(
    taskId: string,
    snapshotConfig: unknown,
    targetKeys: readonly string[],
  ): string[] {
    if (!isRecord(snapshotConfig) || targetKeys.length === 0) return []
    const keySet = new Set(targetKeys)
    const expected = buildComparableCheckpointConfig(snapshotConfig)
    const currentConfig = buildComparableCheckpointConfig(this.buildCheckpointConfig(taskId))
    const mismatches: string[] = []
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (!keySet.has(key)) continue
      const currentValue = currentConfig[key]
      if (currentValue !== expectedValue) {
        mismatches.push(
          `${key}: checkpoint=${formatComparableValue(expectedValue)}, current=${formatComparableValue(currentValue)}`,
        )
      }
    }

    return mismatches
  }

  /** Detect TTS config drift that requires restarting synthesizing segments. */
  private shouldResetSynthesisProgress(
    taskId: string,
    resumeStage: StepName,
    snapshotConfig: unknown,
  ): boolean {
    if (resumeStage !== 'synthesizing') return false
    const hasCompletedSynthesisSegments = this.deps.taskSegmentDao
      .listByTaskAndStage(taskId, 'synthesizing')
      .some((segment) => segment.status === 'success')
    if (!hasCompletedSynthesisSegments) return false

    const ttsCheckpointKeys = [
      'ttsProvider',
      'ttsApiBaseUrl',
      'ttsModelId',
      'ttsVoiceId',
      'ttsSpeed',
      'ttsPitch',
      'ttsVolume',
      'piperExecutablePath',
      'piperModelPath',
      'piperConfigPath',
      'piperSpeakerId',
      'piperLengthScale',
      'piperNoiseScale',
      'piperNoiseW',
      'ttsSplitThresholdChars',
      'ttsTargetSegmentChars',
    ] as const
    const mismatches = this.listCheckpointConfigMismatches(taskId, snapshotConfig, ttsCheckpointKeys)
    if (mismatches.length === 0) return false

    this.emit('log', {
      taskId,
      stage: 'engine',
      level: 'info',
      text: `Resume ignores checkpoint config lock; synthesis config changed (${mismatches.slice(0, 3).join(' | ')})`,
      timestamp: new Date().toISOString(),
    })
    return true
  }

  /** Merge checkpoint failed ids with unresolved stage segments. */
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

  /** Infer resume stage from existing artifacts when checkpoint is missing. */
  private resolveFallbackResumeStage(taskId: string): StepName {
    const artifactTypes = new Set<ArtifactTypeForResume>(
      this.deps.artifactDao
        .listArtifacts(taskId)
        .map((item) => item.artifactType as ArtifactTypeForResume),
    )
    const preferred = this.resolvePreferredResumeStage(taskId)
    const preferredIndex = preferred ? STAGES.indexOf(preferred) : -1
    const startIndex = preferredIndex >= 0 ? preferredIndex : STAGES.length - 1
    for (let index = startIndex; index >= 0; index -= 1) {
      const candidate = STAGES[index]
      if (canResumeAtStage(candidate, artifactTypes)) {
        return candidate
      }
    }
    return 'downloading'
  }

  /** Pick preferred resume stage from latest failed/running/last step record. */
  private resolvePreferredResumeStage(taskId: string): StepName | null {
    const steps = this.deps.taskStepDao.listSteps(taskId)
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      const step = steps[index]
      if (step.status === 'failed' || step.status === 'running') {
        return step.stepName
      }
    }
    if (steps.length === 0) return null
    return steps[steps.length - 1]?.stepName ?? null
  }

  /** Validate stage segment ordering and source text consistency. */
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

  /** Resolve bounded TTS segment concurrency based on provider and config. */
  private resolveTtsConcurrency(taskId: string, totalSegments: number): number {
    const settings = this.resolveExecutionSettings(taskId)
    const task = this.deps.taskDao.getTaskById(taskId)
    const snapshot = (task.modelConfigSnapshot ?? {}) as Record<string, unknown>
    const requested = snapshot.ttsPollingConcurrency
    const defaultConcurrency = settings.ttsProvider === 'qwen' ? 4 : 3
    const configured =
      typeof requested === 'number' && Number.isFinite(requested)
        ? Math.floor(requested)
        : defaultConcurrency
    const providerCap =
      settings.ttsProvider === 'piper'
        ? 1
        : settings.ttsProvider === 'qwen'
          ? 6
          : 3
    return Math.max(1, Math.min(providerCap, configured, Math.max(1, totalSegments)))
  }

  /** Read a fresh settings snapshot before executing external providers. */
  private resolveExecutionSettings(taskId: string): AppSettings {
    this.deps.taskDao.getTaskById(taskId)
    return {
      ...this.deps.settingsDao.getSettings(),
    }
  }

  /** Translate transcript segments with retries, checkpoints, and integrity checks. */
  private async executeTranslating(context: TaskExecutionContext): Promise<void> {
    if (!context.transcriptPath) throw new Error('transcriptPath is missing')
    const task = this.deps.taskDao.getTaskById(context.taskId)
    const settings = this.resolveExecutionSettings(context.taskId)
    const translationContextChars = this.resolveTranslationContextChars(context.taskId)
    const translateRequestTimeoutMs = this.resolveTranslateRequestTimeoutMs(context.taskId)
    const polishConfig = this.resolvePolishConfig(context.taskId)
    const sourceText = await fs.readFile(context.transcriptPath, 'utf-8')
    const segmentation = this.resolveSegmentationConfig(context.taskId)
    const sourceTokenCount = estimateTokenCount(sourceText)
    const retrySet = this.resolveRetrySet(context.taskId)
    const maxAttempts = Math.max(1, settings.retryPolicy.translate + 1)
    const fallbackSplitThresholdTokens = 3_000
    let splitThresholdTokens = this.resolveTranslateSplitThresholdTokens(context.taskId)
    let autoResegmented = false
    let orderedSegments: TaskSegmentRecord[] | null = null

    while (!orderedSegments) {
      const segments = this.buildTranslationSegments({
        sourceText,
        splitThresholdTokens,
      })
      assertSegmentIntegrity(sourceText, segments)
      this.emit('log', {
        taskId: context.taskId,
        stage: 'translating',
        level: 'info',
        text: `Translation window policy: sourceTokens=${sourceTokenCount}, splitThresholdTokens=${splitThresholdTokens}, segments=${segments.length}, autoResegmented=${autoResegmented}`,
        timestamp: new Date().toISOString(),
      })

      const stageSegments = await this.ensureStageSegments(context.taskId, 'translating', segments)
      const effectiveRetrySet =
        retrySet && stageSegments.some((segment) => retrySet.has(segment.id))
          ? retrySet
          : null
      if (retrySet && !effectiveRetrySet) {
        this.emit('log', {
          taskId: context.taskId,
          stage: 'translating',
          level: 'info',
          text: 'Retry segment ids are stale after segment rebuild; fallback to rerun unresolved translation segments',
          timestamp: new Date().toISOString(),
        })
      }
      const total = stageSegments.length
      let completed = stageSegments.filter((segment) => segment.status === 'success').length
      const failedSegmentErrors: string[] = []
      let hasIncompleteFailure = false
      let firstMissingContentFailure: { segmentIndex: number; code: string } | null = null

      for (const segment of stageSegments) {
        if (this.cancelRequested.has(context.taskId)) {
          throw new Error('Task canceled')
        }
        if (segment.status === 'success' && (!effectiveRetrySet || !effectiveRetrySet.has(segment.id))) {
          continue
        }
        if (effectiveRetrySet && !effectiveRetrySet.has(segment.id)) {
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
            const candidate = await translateText({
              settings,
              sourceText: segmentSourceText,
              targetLanguage: task.targetLanguage,
              timeoutMs: translateRequestTimeoutMs,
              context: {
                previousText: trimContextWindow(previousSegmentText, translationContextChars, true),
                segmentIndex: segment.segmentIndex,
                totalSegments: total,
              },
            })
            const validationError = this.validateTranslatedSegment({
              sourceText: segmentSourceText,
              translatedText: candidate,
              targetLanguage: task.targetLanguage,
            })
            if (validationError) {
              throw new Error(validationError)
            }
            translatedText = candidate
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
            const message = error instanceof Error ? error.message : String(error)
            this.emit('log', {
              taskId: context.taskId,
              stage: 'translating',
              level: 'warn',
              text: `Translate segment #${segment.segmentIndex + 1}/${total} attempt ${attempt} failed in ${
                Date.now() - attemptStartedAt
              }ms: ${message}`,
              timestamp: new Date().toISOString(),
            })

            const incompleteFailure = this.isTranslationIncompleteError(message)
            if (incompleteFailure) {
              hasIncompleteFailure = true
            }
            const kind = classifyError('E_TRANSLATE_SEGMENT', message)
            if (incompleteFailure || kind !== 'retryable' || attempt >= maxAttempts) {
              break
            }
            const isMissingContent = this.isMissingContentError(message)
            if (isMissingContent) {
              await sleep(Math.min(60_000, 15_000 * attempt))
              continue
            }
            await sleep(Math.min(4_000, 1000 * (2 ** (attempt - 1))))
          }
        }

        if (!translatedText) {
          const message =
            lastError instanceof Error ? lastError.message : 'Unknown translating segment error'
          const isIncomplete = this.isTranslationIncompleteError(message)
          if (isIncomplete) {
            hasIncompleteFailure = true
          }
          const errorCode = isIncomplete ? 'E_TRANSLATE_INCOMPLETE' : 'E_TRANSLATE_SEGMENT'
          this.deps.taskSegmentDao.markSegmentFailed(segment.id, {
            errorCode,
            errorMessage: message,
            incrementRetry: true,
          })
          this.emit('segmentFailed', {
            taskId: context.taskId,
            stage: 'translating',
            segmentId: segment.id,
            errorCode,
            errorMessage: message,
            retryable:
              !isIncomplete &&
              classifyError('E_TRANSLATE_SEGMENT', message) === 'retryable',
          })
          failedSegmentErrors.push(
            `#${segment.segmentIndex + 1}:${message}`,
          )

          if (this.isMissingContentError(message) && !firstMissingContentFailure) {
            firstMissingContentFailure = {
              segmentIndex: segment.segmentIndex,
              code: this.getMissingContentCode(message) ?? 'unknown',
            }
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
      const canAutoResegment =
        failed.length > 0 &&
        !autoResegmented &&
        hasIncompleteFailure &&
        splitThresholdTokens > fallbackSplitThresholdTokens &&
        this.shouldSplitTranslationByContextWindow(sourceText, fallbackSplitThresholdTokens)
      if (canAutoResegment) {
        this.emit('log', {
          taskId: context.taskId,
          stage: 'translating',
          level: 'warn',
          text: `Detected incomplete translation output. Auto resegment once: splitThresholdTokens ${splitThresholdTokens} -> ${fallbackSplitThresholdTokens}`,
          timestamp: new Date().toISOString(),
        })
        this.deps.taskSegmentDao.clearByTaskAndStage(context.taskId, 'translating')
        splitThresholdTokens = fallbackSplitThresholdTokens
        autoResegmented = true
        continue
      }

      if (failed.length > 0) {
        if (firstMissingContentFailure) {
          throw new Error(
            `Translation provider returned empty content (${firstMissingContentFailure.code}) on segment #${firstMissingContentFailure.segmentIndex + 1}. Stop early to avoid cascading failures; retry later.`,
          )
        }
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
      orderedSegments = ordered
    }

    const translated = joinTranslatedChunks(orderedSegments.map((segment) => segment.targetText ?? ''))
    const estimatedLongByDuration =
      typeof context.audioDurationSec === 'number' &&
      Number.isFinite(context.audioDurationSec) &&
      context.audioDurationSec >= polishConfig.minDurationSec
    const estimatedLongBySegmentCount = orderedSegments.length >= 120
    if (polishConfig.autoPolishLongText && (estimatedLongByDuration || estimatedLongBySegmentCount)) {
      this.emit('log', {
        taskId: context.taskId,
        stage: 'translating',
        level: 'info',
        text: `Auto polishing enabled for long content (segments=${orderedSegments.length}, durationSec=${
          context.audioDurationSec ?? 'unknown'
        })`,
        timestamp: new Date().toISOString(),
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

  /** Synthesize translated text into segment audio and concatenate outputs. */
  private async executeSynthesizing(context: TaskExecutionContext): Promise<void> {
    if (!context.translationPath) throw new Error('translationPath is missing')
    if (!context.toolchain) throw new Error('toolchain is not ready')
    const settings = this.resolveExecutionSettings(context.taskId)
    const translationText = await fs.readFile(context.translationPath, 'utf-8')
    const normalizedTranslation = translationText.trim()
    const usePiperSegmentation = settings.ttsProvider === 'piper'
    const useGlmSegmentation = settings.ttsProvider === 'glm'
    const useQwenSegmentation = settings.ttsProvider === 'qwen'
    let baseSegments: TextSegment[]

    if (usePiperSegmentation) {
      const ttsSegmentation = this.resolveTtsSegmentationConfig(context.taskId)
      baseSegments = this.buildTtsSegments({
        sourceText: normalizedTranslation,
        splitThresholdChars: ttsSegmentation.splitThresholdChars,
        targetSegmentChars: ttsSegmentation.targetSegmentChars,
      })
      assertSegmentIntegrity(translationText, baseSegments)
      this.emit('log', {
        taskId: context.taskId,
        stage: 'synthesizing',
        level: 'info',
        text: `TTS segmentation policy: sourceChars=${normalizedTranslation.length}, splitThresholdChars=${ttsSegmentation.splitThresholdChars}, targetSegmentChars=${ttsSegmentation.targetSegmentChars}, segments=${baseSegments.length}`,
        timestamp: new Date().toISOString(),
      })
    } else if (useQwenSegmentation) {
      const ttsSegmentation = this.resolveTtsSegmentationConfig(context.taskId)
      const tokenLimitedModel = this.isQwenTokenLimitedModel(settings.ttsModelId)
      baseSegments = this.buildQwenTtsSegments({
        sourceText: normalizedTranslation,
        modelId: settings.ttsModelId,
        targetSegmentChars: ttsSegmentation.targetSegmentChars,
      })
      assertSegmentIntegrity(translationText, baseSegments)
      this.emit('log', {
        taskId: context.taskId,
        stage: 'synthesizing',
        level: 'info',
        text: `Qwen TTS segmentation policy: sourceChars=${normalizedTranslation.length}, model=${
          settings.ttsModelId || '(empty)'
        }, sentenceBoundaryOnly=true, hardCharLimit=${QWEN_TTS_MAX_INPUT_CHARS}, hardTokenLimit=${
          tokenLimitedModel ? QWEN_TTS_MAX_INPUT_TOKENS : 'n/a'
        }, hardUtf8BytesLimit=${QWEN_TTS_MAX_INPUT_UTF8_BYTES}, targetSegmentChars=${
          Math.min(ttsSegmentation.targetSegmentChars, QWEN_TTS_MAX_INPUT_CHARS)
        }, segments=${baseSegments.length}`,
        timestamp: new Date().toISOString(),
      })
    } else if (useGlmSegmentation) {
      const ttsSegmentation = this.resolveTtsSegmentationConfig(context.taskId)
      baseSegments = this.buildGlmTtsSegments({
        sourceText: normalizedTranslation,
        targetSegmentChars: ttsSegmentation.targetSegmentChars,
      })
      assertSegmentIntegrity(translationText, baseSegments)
      this.emit('log', {
        taskId: context.taskId,
        stage: 'synthesizing',
        level: 'info',
        text: `GLM TTS segmentation policy: sourceChars=${normalizedTranslation.length}, model=${
          settings.ttsModelId || '(empty)'
        }, sentenceBoundaryOnly=true, hardCharLimit=${GLM_TTS_MAX_INPUT_CHARS}, targetSegmentChars=${
          Math.min(ttsSegmentation.targetSegmentChars, GLM_TTS_MAX_INPUT_CHARS)
        }, segments=${baseSegments.length}`,
        timestamp: new Date().toISOString(),
      })
    } else {
      baseSegments = normalizedTranslation
        ? buildSegmentsFromChunkTexts([normalizedTranslation])
        : []
      assertSegmentIntegrity(translationText, baseSegments)
      this.emit('log', {
        taskId: context.taskId,
        stage: 'synthesizing',
        level: 'info',
        text: `TTS full-text mode enabled for provider=${settings.ttsProvider}: sourceChars=${normalizedTranslation.length}, segments=${baseSegments.length}`,
        timestamp: new Date().toISOString(),
      })
    }

    const stageSegments = await this.ensureStageSegments(context.taskId, 'synthesizing', baseSegments)
    const retrySet = this.resolveRetrySet(context.taskId)
    const effectiveRetrySet =
      retrySet && stageSegments.some((segment) => retrySet.has(segment.id))
        ? retrySet
        : null
    if (retrySet && !effectiveRetrySet) {
      this.emit('log', {
        taskId: context.taskId,
        stage: 'synthesizing',
        level: 'info',
        text: 'Retry segment ids are stale after segment rebuild; fallback to rerun unresolved synthesis segments',
        timestamp: new Date().toISOString(),
      })
    }
    const total = stageSegments.length
    let completed = stageSegments.filter((segment) => segment.status === 'success').length
    const maxAttempts = Math.max(1, settings.retryPolicy.tts + 1)
    const segmentDir = path.join(context.taskDir, this.buildUniqueName('tts-segments'))
    await fs.mkdir(segmentDir, { recursive: true })

    const runnableSegments = stageSegments.filter((segment) => {
      if (segment.status === 'success' && (!effectiveRetrySet || !effectiveRetrySet.has(segment.id))) return false
      if (effectiveRetrySet && !effectiveRetrySet.has(segment.id)) return false
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
          const synth = await synthesizeSpeech({
            settings,
            text: segment.sourceText ?? '',
          })
          const targetPath = this.buildUniqueFilePath(
            segmentDir,
            `tts-segment-${segment.segmentIndex.toString().padStart(4, '0')}`,
            synth.extension ?? 'mp3',
          )
          if (synth.audioBuffer && synth.audioBuffer.length > 0) {
            await fs.writeFile(targetPath, synth.audioBuffer)
          } else if (synth.downloadUrl) {
            await downloadToFile(synth.downloadUrl, targetPath)
          } else {
            throw new Error('TTS response missing audio payload')
          }
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

  /** Produce final TTS artifact by promoting the raw synthesized audio file. */
  private async executeMerging(context: TaskExecutionContext): Promise<void> {
    if (!context.ttsRawPath) throw new Error('ttsRawPath is missing')
    const finalPath = this.buildUniqueFilePath(context.taskDir, 'tts-final-audio', 'mp3')
    await fs.copyFile(context.ttsRawPath, finalPath)
    context.finalTtsPath = finalPath
  }

  /** Persist canceled state and emit task cancellation events. */
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

  /** Emit typed task-engine events through the internal event emitter. */
  private emit<T extends EventName>(event: T, payload: TaskEngineEvents[T]): void {
    this.emitter.emit(event, payload)
  }
}
