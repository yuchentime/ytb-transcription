export type TaskStatus =
  | 'idle'
  | 'queued'
  | 'downloading'
  | 'extracting'
  | 'transcribing'
  | 'translating'
  | 'synthesizing'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'canceled'

export type StepName =
  | 'downloading'
  | 'extracting'
  | 'transcribing'
  | 'translating'
  | 'synthesizing'
  | 'merging'

export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export type ArtifactType = 'video' | 'audio' | 'transcript' | 'translation' | 'tts'
export type YtDlpAuthMode = 'none' | 'browser_cookies' | 'cookies_file'
export type YtDlpCookiesBrowser = 'chrome' | 'chromium' | 'edge' | 'firefox' | 'safari' | 'brave'

export interface CreateTaskInput {
  youtubeUrl: string
  youtubeTitle?: string
  sourceLanguage?: string | null
  targetLanguage?: string
  whisperModel?: string | null
  provider?: 'minimax'
  translateModelId?: string | null
  ttsModelId?: string | null
  ttsVoice?: string | null
  modelConfigSnapshot?: Record<string, unknown> | null
}

export interface TaskRecord {
  id: string
  youtubeUrl: string
  youtubeTitle: string | null
  status: TaskStatus
  sourceLanguage: string | null
  targetLanguage: string
  whisperModel: string | null
  provider: 'minimax'
  translateModelId: string | null
  ttsModelId: string | null
  ttsVoice: string | null
  modelConfigSnapshot: Record<string, unknown> | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface TaskStepRecord {
  id: number
  taskId: string
  stepName: StepName
  status: StepStatus
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  retryCount: number
  logExcerpt: string | null
  errorCode: string | null
  errorMessage: string | null
}

export interface ArtifactRecord {
  id: number
  taskId: string
  artifactType: ArtifactType
  filePath: string
  fileSize: number | null
  mimeType: string | null
  createdAt: string
}

export interface HistoryQuery {
  page?: number
  pageSize?: number
  status?: TaskStatus
  targetLanguage?: string
  keyword?: string
}

export interface HistoryListResult {
  items: TaskRecord[]
  total: number
  page: number
  pageSize: number
}

export interface AppSettings {
  provider: 'minimax'
  ytDlpAuthMode: YtDlpAuthMode
  ytDlpCookiesBrowser: YtDlpCookiesBrowser
  ytDlpCookiesFilePath: string
  defaultWhisperModel: 'tiny' | 'base' | 'small' | 'medium' | 'large'
  minimaxApiKey: string
  minimaxApiBaseUrl: string
  translateModelId: string
  translateTemperature: number
  ttsModelId: string
  ttsVoiceId: string
  ttsSpeed: number
  ttsPitch: number
  ttsVolume: number
  defaultTargetLanguage: 'zh' | 'en' | 'ja'
  stageTimeoutMs: number
  retryPolicy: {
    download: number
    translate: number
    tts: number
    transcribe: number
  }
}
