import type { AppSettings, ArtifactRecord, TaskStatus } from '../../electron/core/db/types'

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

export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'minimax',
  ytDlpAuthMode: 'none',
  ytDlpCookiesBrowser: 'chrome',
  ytDlpCookiesFilePath: '',
  defaultWhisperModel: 'base',
  minimaxApiKey: '',
  minimaxApiBaseUrl: 'https://api.minimaxi.com',
  translateModelId: 'MiniMax-M2.5',
  translateTemperature: 0.3,
  ttsModelId: '',
  ttsVoiceId: '',
  ttsSpeed: 1,
  ttsPitch: 0,
  ttsVolume: 1,
  defaultTargetLanguage: 'zh-CN',
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
