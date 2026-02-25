import type { TranslateProvider, TtsProvider } from '../../electron/core/db/types'
import type { TranslateKey } from './i18n'
import {
  DEFAULT_CUSTOM_API_BASE_URL,
  PROVIDER_BASE_URLS,
  QWEN_REGION_BASE_URLS,
} from '../../shared/providerBaseUrls'

// Translation provider options - label is i18n key
export const TRANSLATE_PROVIDERS: { value: TranslateProvider; labelKey: TranslateKey }[] = [
  { value: 'minimax', labelKey: 'settings.provider.minimax' },
  { value: 'deepseek', labelKey: 'settings.provider.deepseek' },
  { value: 'glm', labelKey: 'settings.provider.glm' },
  { value: 'kimi', labelKey: 'settings.provider.kimi' },
  { value: 'custom', labelKey: 'settings.provider.custom' },
]

// TTS provider options - label is i18n key
export const TTS_PROVIDERS: { value: TtsProvider; labelKey: TranslateKey }[] = [
  { value: 'minimax', labelKey: 'settings.provider.minimax' },
  { value: 'openai', labelKey: 'settings.provider.openai' },
  { value: 'glm', labelKey: 'settings.provider.glm' },
  { value: 'qwen', labelKey: 'settings.provider.qwen' },
]

// Default base URLs for providers
export const DEFAULT_BASE_URLS = PROVIDER_BASE_URLS
export const DEFAULT_CUSTOM_BASE_URL = DEFAULT_CUSTOM_API_BASE_URL

export const QWEN_REGION_PROVIDER_OPTIONS: Array<{
  value: 'qwen-cn' | 'qwen-sg' | 'qwen-us'
  baseUrl: string
  labelKey: TranslateKey
}> = [
  {
    value: 'qwen-cn',
    baseUrl: QWEN_REGION_BASE_URLS.cn,
    labelKey: 'settings.provider.qwen.cn',
  },
  {
    value: 'qwen-sg',
    baseUrl: QWEN_REGION_BASE_URLS.sg,
    labelKey: 'settings.provider.qwen.sg',
  },
  {
    value: 'qwen-us',
    baseUrl: QWEN_REGION_BASE_URLS.us,
    labelKey: 'settings.provider.qwen.us',
  },
]
