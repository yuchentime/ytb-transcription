import type {
  AppSettings,
  ArtifactRecord,
  CreateTaskInput,
  HistoryListResult,
  HistoryQuery,
  TaskRecord,
  TaskStatus,
  TaskStepRecord,
} from '../core/db/types'

export const IPC_CHANNELS = {
  taskCreate: 'task:create',
  taskStart: 'task:start',
  taskCancel: 'task:cancel',
  taskRetry: 'task:retry',
  taskGet: 'task:get',
  historyList: 'history:list',
  historyDelete: 'history:delete',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  taskStatus: 'task:status',
  taskProgress: 'task:progress',
  taskLog: 'task:log',
  taskCompleted: 'task:completed',
  taskFailed: 'task:failed',
  taskRuntime: 'task:runtime',
} as const

export interface TaskIdPayload {
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

export interface TaskDetail {
  task: TaskRecord
  steps: TaskStepRecord[]
  artifacts: ArtifactRecord[]
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

export interface RendererAPI {
  task: {
    create(input: CreateTaskInput): Promise<TaskRecord>
    start(payload: TaskIdPayload): Promise<TaskActionResult>
    cancel(payload: TaskIdPayload): Promise<TaskCancelResult>
    retry(payload: TaskIdPayload): Promise<TaskActionResult>
    get(payload: TaskIdPayload): Promise<TaskDetail>
    onStatus(listener: (payload: TaskStatusEventPayload) => void): () => void
    onProgress(listener: (payload: TaskProgressEventPayload) => void): () => void
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
}
