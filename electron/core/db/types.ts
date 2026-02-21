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
export type SegmentStatus = 'pending' | 'running' | 'success' | 'failed'
export type SegmentStageName = 'translating' | 'synthesizing'
export type SegmentationStrategy = 'punctuation' | 'sentence' | 'duration'
export type RecoveryErrorKind = 'retryable' | 'non-retryable' | 'config-invalid'

export interface SegmentationOptions {
  maxCharsPerSegment?: number
  targetSegmentLength?: number
  targetDurationSec?: number
}

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
  segmentationStrategy?: SegmentationStrategy
  segmentationOptions?: SegmentationOptions
  ttsSpeed?: number
  ttsPitch?: number
  ttsVolume?: number
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

export interface TaskSegmentRecord {
  id: string
  taskId: string
  stageName: SegmentStageName
  segmentIndex: number
  sourceText: string | null
  targetText: string | null
  status: SegmentStatus
  retryCount: number
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
}

export interface TaskRecoverySnapshotRecord {
  id: number
  taskId: string
  stageName: string
  checkpointKey: string
  snapshotJson: Record<string, unknown>
  createdAt: string
}

export interface SegmentRetryError {
  code: string
  message: string
  kind: RecoveryErrorKind
}

export interface RecoveryAction {
  action: 'retryFailedSegments' | 'resumeFromCheckpoint' | 'fixConfig' | 'checkPermissions' | 'waitAndRetry'
  label: string
  reason: string
}

export interface RecoveryPlan {
  taskId: string
  fromStage: string | null
  failedSegments: Array<{
    id: string
    stageName: SegmentStageName
    errorCode: string | null
    errorMessage: string | null
  }>
  actions: RecoveryAction[]
}

export interface VoiceProfile {
  id: string
  displayName: string
  description: string
  language: 'zh' | 'en' | 'ja' | 'multi'
  speedRange: [number, number]
  pitchRange: [number, number]
  volumeRange: [number, number]
}

export interface VoiceParamInput {
  voiceId?: string | null
  speed?: number
  pitch?: number
  volume?: number
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
