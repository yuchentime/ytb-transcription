import type {
  AppSettings,
  ArtifactRecord,
  BatchDetail,
  BatchProgress,
  CreateTaskInput,
  HistoryListResult,
  HistoryQuery,
  QueueSnapshot,
  RecoveryAction,
  RecoveryPlan,
  TaskRecord,
  TaskRecoverySnapshotRecord,
  TaskSegmentRecord,
  TaskStatus,
  TaskStepRecord,
  VoiceParamInput,
  VoiceProfile,
} from '../core/db/types'

export const IPC_CHANNELS = {
  taskCreate: 'task:create',
  taskStart: 'task:start',
  taskCancel: 'task:cancel',
  taskRetry: 'task:retry',
  taskGet: 'task:get',
  taskGetRunning: 'task:getRunning',
  taskSegments: 'task:segments',
  taskRetrySegments: 'task:retrySegments',
  taskResumeFromCheckpoint: 'task:resumeFromCheckpoint',
  taskRecoveryPlan: 'task:recoveryPlan',
  historyList: 'history:list',
  historyDelete: 'history:delete',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  voicesList: 'voices:list',
  voicesValidateParams: 'voices:validateParams',
  systemOpenPath: 'system:openPath',
  systemExportTaskArtifacts: 'system:exportTaskArtifacts',
  systemProbePiper: 'system:probePiper',
  systemInstallPiper: 'system:installPiper',
  systemTestTranslateConnectivity: 'system:testTranslateConnectivity',
  fileReadAudio: 'file:readAudio',
  fileReadText: 'file:readText',
  batchCreate: 'batch:create',
  batchGet: 'batch:get',
  queueList: 'queue:list',
  queuePause: 'queue:pause',
  queueResume: 'queue:resume',
  queueReorder: 'queue:reorder',
  queueRemove: 'queue:remove',
  taskStatus: 'task:status',
  taskProgress: 'task:progress',
  taskSegmentProgress: 'task:segmentProgress',
  taskSegmentFailed: 'task:segmentFailed',
  taskRecoverySuggested: 'task:recoverySuggested',
  taskLog: 'task:log',
  taskCompleted: 'task:completed',
  taskFailed: 'task:failed',
  taskRuntime: 'task:runtime',
  queueUpdated: 'queue:updated',
  queueTaskMoved: 'queue:taskMoved',
  batchProgress: 'batch:progress',
  batchCompleted: 'batch:completed',
} as const

export interface TaskIdPayload {
  taskId: string
}

export interface RetrySegmentsPayload extends TaskIdPayload {
  segmentIds: string[]
}

export type BatchConfig = Omit<CreateTaskInput, 'youtubeUrl' | 'youtubeTitle'>

export interface BatchCreatePayload {
  urls: string[]
  sharedConfig: BatchConfig
  name?: string
}

export interface BatchCreateResult {
  batchId: string
  taskIds: string[]
  accepted: number
  rejected: number
  rejectedItems: Array<{
    url: string
    reason: string
  }>
}

export interface BatchGetPayload {
  batchId: string
}

export interface QueueReorderPayload {
  taskId: string
  toIndex: number
}

export interface QueueRemovePayload {
  taskId: string
}

export interface TaskActionResult {
  accepted: boolean
  reason?: string
}

export interface TaskCancelResult {
  canceled: boolean
}

export interface HistoryDeleteResult {
  deleted: boolean
}

export interface OpenPathPayload {
  path: string
}

export interface OpenPathResult {
  ok: boolean
}

export interface ExportTaskArtifactsPayload {
  taskId: string
}

export interface ExportTaskArtifactsResult {
  exportDir: string
  files: string[]
}

export interface ProbePiperPayload {
  settings?: Partial<AppSettings>
}

export interface InstallPiperPayload {
  settings?: Partial<AppSettings>
  forceReinstall?: boolean
}

export interface TestTranslateConnectivityPayload {
  settings?: Partial<AppSettings>
}

export interface TranslateConnectivityResult {
  ok: boolean
  message: string
}

export interface PiperProbeCheckResult {
  ok: boolean
  path: string
  message: string
}

export interface PiperProbeResult {
  ok: boolean
  summary: string
  binary: PiperProbeCheckResult
  model: PiperProbeCheckResult
  config: PiperProbeCheckResult
}

export interface PiperInstallResult {
  summary: string
  releaseTag: string
  voice: string
  piperExecutablePath: string
  piperModelPath: string
  piperConfigPath: string
}

export interface TaskDetail {
  task: TaskRecord
  steps: TaskStepRecord[]
  artifacts: ArtifactRecord[]
  segments: TaskSegmentRecord[]
  recoverySnapshots: TaskRecoverySnapshotRecord[]
}

export interface TaskStatusEventPayload {
  taskId: string
  status: TaskStatus
  timestamp: string
}

export interface TaskProgressEventPayload {
  taskId: string
  stage: string
  percent: number
  message: string
  /** 下载速度（格式化的字符串，如 "2.5 MB/s"） */
  speed?: string
}

export interface TaskSegmentProgressEventPayload {
  taskId: string
  stage: string
  segmentId: string
  index: number
  total: number
  percent: number
  message: string
}

export interface TaskSegmentFailedEventPayload {
  taskId: string
  stage: string
  segmentId: string
  errorCode: string
  errorMessage: string
  retryable: boolean
}

export interface TaskRecoverySuggestedEventPayload {
  taskId: string
  actions: RecoveryAction[]
}

export interface TaskLogEventPayload {
  taskId: string
  stage: string
  level: 'info' | 'warn' | 'error'
  text: string
  timestamp: string
}

export interface TaskCompletedEventPayload {
  taskId: string
  output: {
    ttsPath?: string
    transcriptPath?: string
    translationPath?: string
  }
}

export interface TaskFailedEventPayload {
  taskId: string
  stage: string
  errorCode: string
  errorMessage: string
}

export interface TaskRuntimeEventPayload {
  taskId: string
  component: 'yt-dlp' | 'ffmpeg' | 'python' | 'whisper' | 'deno' | 'engine'
  status: 'checking' | 'downloading' | 'installing' | 'ready' | 'error'
  message: string
  timestamp: string
}

export interface QueueUpdatedEventPayload {
  paused: boolean
  waiting: number
  running: number
  completed: number
  failed: number
  updatedAt: string
}

export interface QueueTaskMovedEventPayload {
  taskId: string
  fromIndex: number
  toIndex: number
}

export interface BatchProgressEventPayload extends BatchProgress {}

export interface BatchCompletedEventPayload {
  batchId: string
  total: number
  completed: number
  failed: number
}

export interface ResumeFromCheckpointResult {
  accepted: boolean
  fromStage: string
  reason?: string
}

export interface VoiceValidateResult {
  valid: boolean
  errors: string[]
}

export interface AudioFileResult {
  data: ArrayBuffer
  mimeType: string
  fileName: string
}

export interface TextFileResult {
  content: string
  fileName: string
}

export interface RendererAPI {
  task: {
    create(input: CreateTaskInput): Promise<TaskRecord>
    start(payload: TaskIdPayload): Promise<TaskActionResult>
    cancel(payload: TaskIdPayload): Promise<TaskCancelResult>
    retry(payload: TaskIdPayload): Promise<TaskActionResult>
    get(payload: TaskIdPayload): Promise<TaskDetail>
    getRunning(): Promise<TaskRecord | null>
    segments(payload: TaskIdPayload): Promise<TaskSegmentRecord[]>
    retrySegments(payload: RetrySegmentsPayload): Promise<TaskActionResult>
    resumeFromCheckpoint(payload: TaskIdPayload): Promise<ResumeFromCheckpointResult>
    recoveryPlan(payload: TaskIdPayload): Promise<RecoveryPlan>
    onStatus(listener: (payload: TaskStatusEventPayload) => void): () => void
    onProgress(listener: (payload: TaskProgressEventPayload) => void): () => void
    onSegmentProgress(listener: (payload: TaskSegmentProgressEventPayload) => void): () => void
    onSegmentFailed(listener: (payload: TaskSegmentFailedEventPayload) => void): () => void
    onRecoverySuggested(listener: (payload: TaskRecoverySuggestedEventPayload) => void): () => void
    onLog(listener: (payload: TaskLogEventPayload) => void): () => void
    onCompleted(listener: (payload: TaskCompletedEventPayload) => void): () => void
    onFailed(listener: (payload: TaskFailedEventPayload) => void): () => void
    onRuntime(listener: (payload: TaskRuntimeEventPayload) => void): () => void
  }
  history: {
    list(query?: HistoryQuery): Promise<HistoryListResult>
    delete(payload: TaskIdPayload): Promise<HistoryDeleteResult>
  }
  batch: {
    create(payload: BatchCreatePayload): Promise<BatchCreateResult>
    get(payload: BatchGetPayload): Promise<BatchDetail>
    onProgress(listener: (payload: BatchProgressEventPayload) => void): () => void
    onCompleted(listener: (payload: BatchCompletedEventPayload) => void): () => void
  }
  queue: {
    list(): Promise<QueueSnapshot>
    pause(): Promise<{ paused: boolean }>
    resume(): Promise<{ resumed: boolean }>
    reorder(payload: QueueReorderPayload): Promise<{ ok: boolean }>
    remove(payload: QueueRemovePayload): Promise<{ removed: boolean }>
    onUpdated(listener: (payload: QueueUpdatedEventPayload) => void): () => void
    onTaskMoved(listener: (payload: QueueTaskMovedEventPayload) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  voices: {
    list(): Promise<VoiceProfile[]>
    validateParams(input: VoiceParamInput): Promise<VoiceValidateResult>
  }
  system: {
    openPath(payload: OpenPathPayload): Promise<OpenPathResult>
    exportTaskArtifacts(payload: ExportTaskArtifactsPayload): Promise<ExportTaskArtifactsResult>
    probePiper(payload?: ProbePiperPayload): Promise<PiperProbeResult>
    installPiper(payload?: InstallPiperPayload): Promise<PiperInstallResult>
    testTranslateConnectivity(payload?: TestTranslateConnectivityPayload): Promise<TranslateConnectivityResult>
  }
  file: {
    readAudio(filePath: string): Promise<AudioFileResult>
    readText(filePath: string): Promise<TextFileResult>
  }
}
