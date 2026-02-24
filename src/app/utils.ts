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

export const RECOVERABLE_STATUSES: TaskStatus[] = [
  'failed',
  'canceled',
  'extracting',
  'transcribing',
  'translating',
  'synthesizing',
]

// Provider-specific model options
export const TRANSLATE_MODEL_OPTIONS: Record<Exclude<TranslateProvider, 'custom'>, string[]> = {
  minimax: ['MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'MiniMax-M2.1', 'MiniMax-M2.1-highspeed', 'MiniMax-M2'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  glm: ['glm-5', 'glm-4.7', 'glm-4.7-flash', 'glm-4.7-flashx', 'glm-4.6', 'glm-4.5-air', 'glm-4.5-airx', 'glm-4.5-flash', 'glm-4-flash-250414', 'glm-4-flashx-250414'],
  kimi: [
    // kimi-k2 系列
    'kimi-k2-0711-preview',
    'kimi-k2-0905-preview',
    'kimi-k2-thinking',
    'kimi-k2-thinking-turbo',
    'kimi-k2-turbo-preview',
    'kimi-k2.5',
    'kimi-latest',
    // moonshot-v1 系列
    'moonshot-v1-128k',
    'moonshot-v1-128k-vision-preview',
    'moonshot-v1-32k',
    'moonshot-v1-32k-vision-preview',
    'moonshot-v1-8k',
    'moonshot-v1-8k-vision-preview',
    'moonshot-v1-auto',
  ],
}

export const TTS_MODEL_OPTIONS: Record<Exclude<TtsProvider, 'piper'>, string[]> = {
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
  ttsTargetLanguage: 'zh',
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
  kimiApiBaseUrl: 'https://api.moonshot.cn/v1',

  // Custom/Local provider (e.g., LM Studio with OpenAI-compatible API)
  customApiKey: '',
  customApiBaseUrl: 'http://localhost:1234/v1', // LM Studio OpenAI-compatible API endpoint

  // Built-in Piper local TTS
  piperExecutablePath: '',
  piperModelPath: '',
  piperConfigPath: '',
  piperSpeakerId: 0,
  piperLengthScale: 1,
  piperNoiseScale: 0.667,
  piperNoiseW: 0.8,

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

export function isValidYoutubeUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }

    const hostname = parsed.hostname.toLowerCase()
    return (
      hostname === 'youtube.com' ||
      hostname === 'www.youtube.com' ||
      hostname === 'm.youtube.com' ||
      hostname === 'youtu.be' ||
      hostname === 'www.youtu.be'
    )
  } catch {
    return false
  }
}

export function isRecoverableTaskStatus(status: TaskStatus): boolean {
  return RECOVERABLE_STATUSES.includes(status)
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
