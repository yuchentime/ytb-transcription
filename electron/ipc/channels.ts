import type {
  AppSettings,
  ArtifactRecord,
  CreateTaskInput,
  HistoryListResult,
  HistoryQuery,
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
  systemExportDiagnostics: 'system:exportDiagnostics',
  systemProbePiper: 'system:probePiper',
  fileReadAudio: 'file:readAudio',
  fileReadText: 'file:readText',
  taskStatus: 'task:status',
  taskProgress: 'task:progress',
  taskSegmentProgress: 'task:segmentProgress',
  taskSegmentFailed: 'task:segmentFailed',
  taskRecoverySuggested: 'task:recoverySuggested',
  taskLog: 'task:log',
  taskCompleted: 'task:completed',
  taskFailed: 'task:failed',
  taskRuntime: 'task:runtime',
} as const

export interface TaskIdPayload {
  taskId: string
}

export interface RetrySegmentsPayload extends TaskIdPayload {
  segmentIds: string[]
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

export interface ExportDiagnosticsPayload {
  taskId?: string
}

export interface ExportDiagnosticsResult {
  filePath: string
}

export interface ProbePiperPayload {
  settings?: Partial<AppSettings>
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
    exportDiagnostics(payload?: ExportDiagnosticsPayload): Promise<ExportDiagnosticsResult>
    probePiper(payload?: ProbePiperPayload): Promise<PiperProbeResult>
  }
  file: {
    readAudio(filePath: string): Promise<AudioFileResult>
    readText(filePath: string): Promise<TextFileResult>
  }
}
