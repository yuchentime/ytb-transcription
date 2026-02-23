import type { TranslateProvider, TtsProvider } from '../../electron/core/db/types'

// Translation provider options - label is i18n key
export const TRANSLATE_PROVIDERS: { value: TranslateProvider; labelKey: string }[] = [
  { value: 'minimax', labelKey: 'settings.provider.minimax' },
  { value: 'deepseek', labelKey: 'settings.provider.deepseek' },
  { value: 'glm', labelKey: 'settings.provider.glm' },
  { value: 'kimi', labelKey: 'settings.provider.kimi' },
  { value: 'custom', labelKey: 'settings.provider.custom' },
]

// TTS provider options - label is i18n key
export const TTS_PROVIDERS: { value: TtsProvider; labelKey: string }[] = [
  { value: 'minimax', labelKey: 'settings.provider.minimax' },
  { value: 'piper', labelKey: 'settings.provider.piper' },
]

// Default base URLs for providers
export const DEFAULT_BASE_URLS = {
  minimax: 'https://api.minimaxi.com',
  deepseek: 'https://api.deepseek.com',
  glm: 'https://open.bigmodel.cn/api/paas',
  kimi: 'https://api.moonshot.cn',
} as const
