import type { AppSettings, ArtifactRecord, TaskStatus, TranslateProvider, TtsProvider } from '../../electron/core/db/types'

export const STAGES = [
  'downloading',
  'extracting',
  'transcribing',
  'translating',
  'synthesizing',
  'merging',
] as const

const RUNNING_STATUSES: TaskStatus[] = [
  'queued',
  'downloading',
  'extracting',
  'transcribing',
  'translating',
  'synthesizing',
  'merging',
]

// Provider-specific model options
export const TRANSLATE_MODEL_OPTIONS: Record<Exclude<TranslateProvider, 'custom'>, string[]> = {
  minimax: ['MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1', 'MiniMax-M2.1-highspeed', 'MiniMax-M2'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  glm: ['glm-4-plus', 'glm-4-flash', 'glm-4-air', 'glm-4-airx', 'glm-4-long'],
  kimi: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
}

export const TTS_MODEL_OPTIONS: Record<Exclude<TtsProvider, 'custom'>, string[]> = {
  minimax: ['speech-2.8-hd', 'speech-2.6-hd', 'speech-2.8-turbo', 'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo'],
  // GLM TTS models based on bigmodel.cn documentation
  glm: ['glm-4-voice', 'glm-4-voice-realtime'],
}

export const DEFAULT_SETTINGS: AppSettings = {
  // Translation provider settings
  translateProvider: 'minimax',
  translateModelId: 'MiniMax-M2.5',
  translateTemperature: 0.3,

  // TTS provider settings
  ttsProvider: 'minimax',
  ttsModelId: '',
  ttsVoiceId: '',
  ttsSpeed: 1,
  ttsPitch: 0,
  ttsVolume: 1,

  // Provider-specific API configurations
  // MiniMax
  minimaxApiKey: '',
  minimaxApiBaseUrl: 'https://api.minimaxi.com',

  // DeepSeek
  deepseekApiKey: '',
  deepseekApiBaseUrl: 'https://api.deepseek.com',

  // GLM
  glmApiKey: '',
  glmApiBaseUrl: 'https://open.bigmodel.cn/api/paas',

  // Kimi
  kimiApiKey: '',
  kimiApiBaseUrl: 'https://api.moonshot.cn',

  // Custom/Local provider (e.g., LM Studio with OpenAI-compatible API)
  customApiKey: '',
  customApiBaseUrl: 'http://localhost:1234/v1', // LM Studio OpenAI-compatible API endpoint

  // YouTube download settings
  ytDlpAuthMode: 'none',
  ytDlpCookiesBrowser: 'chrome',
  ytDlpCookiesFilePath: '',

  // Transcription settings
  defaultWhisperModel: 'base',

  // Default target language
  defaultTargetLanguage: 'zh',

  // Timeout and retry settings
  stageTimeoutMs: 10 * 60 * 1000,
  retryPolicy: {
    download: 2,
    translate: 2,
    tts: 2,
    transcribe: 0,
  },
}

export function isRunningStatus(status: TaskStatus | ''): boolean {
  if (!status) return false
  return RUNNING_STATUSES.includes(status)
}

export function formatDateTime(value: string | null, locale?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(locale)
}

export function findLatestArtifactPath(
  artifacts: ArtifactRecord[],
  targetType: ArtifactRecord['artifactType'],
): string | undefined {
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    if (artifacts[index].artifactType === targetType) {
      return artifacts[index].filePath
    }
  }
  return undefined
}
