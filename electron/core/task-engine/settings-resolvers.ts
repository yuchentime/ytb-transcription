import type { AppSettings } from '../db/types'
import type { CheckpointComparableValue } from './utils'
import { isRecord, toComparableNumber, toComparableString, toComparableBoolean } from './utils'

/**
 * Resolve translate API base URL from settings.
 */
export function resolveTranslateApiBaseUrl(settings: AppSettings): string {
  switch (settings.translateProvider) {
    case 'minimax':
      return settings.minimaxApiBaseUrl
    case 'deepseek':
      return settings.deepseekApiBaseUrl
    case 'glm':
      return settings.glmApiBaseUrl
    case 'kimi':
      return settings.kimiApiBaseUrl
    case 'custom':
      return settings.customApiBaseUrl
  }
}

/**
 * Resolve TTS API base URL from settings.
 */
export function resolveTtsApiBaseUrl(settings: AppSettings): string {
  switch (settings.ttsProvider) {
    case 'minimax':
      return settings.minimaxApiBaseUrl
    case 'openai':
      return settings.openaiApiBaseUrl
    case 'glm':
      return settings.glmApiBaseUrl
    case 'qwen':
      return settings.qwenApiBaseUrl
    case 'piper':
      return ''
  }
}

/**
 * Normalize endpoint URL for logging (remove sensitive path details).
 */
export function normalizeEndpointForLog(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) return '(empty)'
  try {
    const parsed = new URL(trimmed)
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
  } catch {
    return trimmed
  }
}

/**
 * Resolve translate API key state from settings.
 */
export function resolveTranslateApiKeyState(settings: AppSettings): 'set' | 'missing' | 'optional-empty' {
  const provider = settings.translateProvider
  const key =
    provider === 'minimax'
      ? settings.minimaxApiKey
      : provider === 'deepseek'
        ? settings.deepseekApiKey
        : provider === 'glm'
          ? settings.glmApiKey
          : provider === 'kimi'
            ? settings.kimiApiKey
            : settings.customApiKey
  if (provider === 'custom' && !key.trim()) {
    return 'optional-empty'
  }
  return key.trim() ? 'set' : 'missing'
}

/**
 * Resolve TTS API key state from settings.
 */
export function resolveTtsApiKeyState(settings: AppSettings): 'set' | 'missing' | 'optional-empty' {
  const provider = settings.ttsProvider
  if (provider === 'piper') {
    return 'optional-empty'
  }
  const key =
    provider === 'minimax'
      ? settings.minimaxApiKey
      : provider === 'openai'
        ? settings.openaiApiKey
        : provider === 'glm'
          ? settings.glmApiKey
          : provider === 'qwen'
            ? settings.qwenApiKey
            : ''
  return key.trim() ? 'set' : 'missing'
}

/**
 * Build comparable checkpoint config for validation.
 */
export function buildComparableCheckpointConfig(config: Record<string, unknown>): Record<string, CheckpointComparableValue> {
  const comparable: Record<string, CheckpointComparableValue> = {}

  const directStringKeys = [
    'targetLanguage',
    'segmentationStrategy',
    'translateProvider',
    'ttsProvider',
    'translateApiBaseUrl',
    'ttsApiBaseUrl',
    'translateModelId',
    'ttsModelId',
    'ttsVoiceId',
    'piperExecutablePath',
    'piperModelPath',
    'piperConfigPath',
  ] as const
  for (const key of directStringKeys) {
    const value = toComparableString(config[key])
    if (value !== undefined) {
      comparable[key] = value
    }
  }

  const directNumberKeys = [
    'ttsSpeed',
    'ttsPitch',
    'ttsVolume',
    'ttsPollingConcurrency',
    'piperSpeakerId',
    'piperLengthScale',
    'piperNoiseScale',
    'piperNoiseW',
  ] as const
  for (const key of directNumberKeys) {
    const value = toComparableNumber(config[key])
    if (value !== undefined) {
      comparable[key] = value
    }
  }
  const directBooleanKeys = ['autoPolishLongText', 'transcribeChunkEnabled'] as const
  for (const key of directBooleanKeys) {
    const value = toComparableBoolean(config[key])
    if (value !== undefined) {
      comparable[key] = value
    }
  }
  const extraNumberKeys = [
    'translationContextChars',
    'translateRequestTimeoutMs',
    'translateSplitThresholdTokens',
    'polishMinDurationSec',
    'polishContextChars',
    'polishTargetSegmentLength',
    'transcribeChunkMinDurationSec',
    'transcribeChunkDurationSec',
    'transcribeChunkOverlapSec',
    'ttsSplitThresholdChars',
    'ttsTargetSegmentChars',
  ] as const
  for (const key of extraNumberKeys) {
    const value = toComparableNumber(config[key])
    if (value !== undefined) {
      comparable[key] = value
    }
  }

  const segmentationOptions = isRecord(config.segmentationOptions) ? config.segmentationOptions : {}
  const maxCharsPerSegment = toComparableNumber(segmentationOptions.maxCharsPerSegment)
  const targetSegmentLength = toComparableNumber(segmentationOptions.targetSegmentLength)
  const targetDurationSec = toComparableNumber(segmentationOptions.targetDurationSec)
  if (maxCharsPerSegment !== undefined) {
    comparable['segmentationOptions.maxCharsPerSegment'] = maxCharsPerSegment
  }
  if (targetSegmentLength !== undefined) {
    comparable['segmentationOptions.targetSegmentLength'] = targetSegmentLength
  }
  if (targetDurationSec !== undefined) {
    comparable['segmentationOptions.targetDurationSec'] = targetDurationSec
  }

  return comparable
}
