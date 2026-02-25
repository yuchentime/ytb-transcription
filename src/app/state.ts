import type {
  AppSettings,
  RecoveryAction,
  TaskRecord,
  TaskSegmentRecord,
  TaskStatus,
  VoiceProfile,
} from '../../electron/core/db/types'
import type { TaskRuntimeEventPayload } from '../../electron/ipc/channels'
import { DEFAULT_SETTINGS } from './utils'

export interface TaskFormState {
  youtubeUrl: string
  targetLanguage: 'zh' | 'en' | 'ja'
  ttsVoiceId: string
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
  saveSuccess: boolean
  saveError: boolean
  saveErrorMessage: string
  voiceProfiles: VoiceProfile[]
  voiceValidationErrors: string[]
}

export interface TaskState {
  form: TaskFormState
  activeTaskId: string
  activeStatus: TaskStatus | ''
  stageProgress: Record<string, number>
  segments: TaskSegmentRecord[]
  recoveryActions: RecoveryAction[]
  logs: LogItem[]
  output: TaskOutput
  running: boolean
  error: string
  ttsAudioUrl: string
  transcriptContent?: string
  translationContent?: string
  /** 当前下载速度（仅在 downloading 阶段有效） */
  downloadSpeed?: string
  /** 当前处理中任务的 YouTube 链接 */
  processingYoutubeUrl: string
  /** 当前处理中任务的 YouTube 标题 */
  processingYoutubeTitle: string
  /** 运行环境准备弹窗是否可见 */
  isRuntimeModalVisible: boolean
  /** 运行环境组件状态映射 */
  runtimeComponentStatus: Record<string, TaskRuntimeEventPayload>
  /** 首次启动运行环境预检状态 */
  runtimeBootstrapStatus: 'idle' | 'preparing' | 'ready' | 'error'
  /** 首次启动运行环境预检错误信息 */
  runtimeBootstrapMessage: string
}

export interface HistoryState {
  items: TaskRecord[]
  total: number
  runningTaskId: string
  query: HistoryQueryState
  loading: boolean
  error: string
  busyTaskId: string
  keywordDraft: string
  statusDraft: 'all' | TaskStatus
  languageDraft: 'all' | 'zh' | 'en' | 'ja'
  recoverableOnly: boolean
}

export function createInitialSettingsState(): SettingsState {
  return {
    data: DEFAULT_SETTINGS,
    loading: true,
    saving: false,
    error: '',
    saveSuccess: false,
    saveError: false,
    saveErrorMessage: '',
    voiceProfiles: [],
    voiceValidationErrors: [],
  }
}

export function createInitialTaskState(): TaskState {
  return {
    form: {
      youtubeUrl: '',
      targetLanguage: 'zh',
      ttsVoiceId: '',
    },
    activeTaskId: '',
    activeStatus: '',
    stageProgress: {},
    segments: [],
    recoveryActions: [],
    logs: [],
    output: {},
    running: false,
    error: '',
    ttsAudioUrl: '',
    transcriptContent: undefined,
    translationContent: undefined,
    processingYoutubeUrl: '',
    processingYoutubeTitle: '',
    isRuntimeModalVisible: false,
    runtimeComponentStatus: {},
    runtimeBootstrapStatus: 'idle',
    runtimeBootstrapMessage: '',
  }
}

export function createInitialHistoryState(): HistoryState {
  return {
    items: [],
    total: 0,
    runningTaskId: '',
    query: { page: 1, pageSize: 10 },
    loading: false,
    error: '',
    busyTaskId: '',
    keywordDraft: '',
    statusDraft: 'all',
    languageDraft: 'all',
    recoverableOnly: false,
  }
}
