import type { AppSettings, TaskRecord, TaskStatus } from '../../electron/core/db/types'
import { DEFAULT_SETTINGS } from './utils'

export interface TaskFormState {
  youtubeUrl: string
  targetLanguage: 'zh' | 'en' | 'ja'
}

export interface TaskOutput {
  ttsPath?: string
  transcriptPath?: string
  translationPath?: string
}

export interface LogItem {
  id: number
  time: string
  stage: string
  level: 'info' | 'warn' | 'error'
  text: string
}

export interface RuntimeItem {
  component: 'yt-dlp' | 'ffmpeg' | 'python' | 'whisper' | 'deno' | 'engine'
  status: 'checking' | 'downloading' | 'installing' | 'ready' | 'error'
  message: string
  timestamp: string
}

export interface HistoryQueryState {
  page: number
  pageSize: number
  status?: TaskStatus
  targetLanguage?: 'zh' | 'en' | 'ja'
  keyword?: string
}

export interface SettingsState {
  data: AppSettings
  loading: boolean
  saving: boolean
  error: string
}

export interface TaskState {
  form: TaskFormState
  activeTaskId: string
  activeStatus: TaskStatus | ''
  stageProgress: Record<string, number>
  runtimeItems: Record<RuntimeItem['component'], RuntimeItem | undefined>
  logs: LogItem[]
  output: TaskOutput
  running: boolean
  error: string
  ttsAudioUrl: string
}

export interface HistoryState {
  items: TaskRecord[]
  total: number
  query: HistoryQueryState
  loading: boolean
  error: string
  busyTaskId: string
  keywordDraft: string
  statusDraft: 'all' | TaskStatus
  languageDraft: 'all' | 'zh' | 'en' | 'ja'
}

export function createInitialSettingsState(): SettingsState {
  return {
    data: DEFAULT_SETTINGS,
    loading: true,
    saving: false,
    error: '',
  }
}

export function createEmptyRuntimeItems(): Record<RuntimeItem['component'], RuntimeItem | undefined> {
  return {
    'yt-dlp': undefined,
    ffmpeg: undefined,
    python: undefined,
    whisper: undefined,
    deno: undefined,
    engine: undefined,
  }
}

export function createInitialTaskState(): TaskState {
  return {
    form: {
      youtubeUrl: '',
      targetLanguage: 'zh',
    },
    activeTaskId: '',
    activeStatus: '',
    stageProgress: {},
    runtimeItems: createEmptyRuntimeItems(),
    logs: [],
    output: {},
    running: false,
    error: '',
    ttsAudioUrl: '',
  }
}

export function createInitialHistoryState(): HistoryState {
  return {
    items: [],
    total: 0,
    query: { page: 1, pageSize: 10 },
    loading: false,
    error: '',
    busyTaskId: '',
    keywordDraft: '',
    statusDraft: 'all',
    languageDraft: 'all',
  }
}
