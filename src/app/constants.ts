import type { TranslateProvider, TtsProvider } from '../../electron/core/db/types'
import type { TranslateKey } from './i18n'

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
  { value: 'qwen', labelKey: 'settings.provider.qwen' },
]

// Default base URLs for providers
export const DEFAULT_BASE_URLS = {
  minimax: 'https://api.minimaxi.com',
  deepseek: 'https://api.deepseek.com',
  glm: 'https://open.bigmodel.cn/api/paas',
  openai: 'https://api.openai.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  kimi: 'https://api.moonshot.cn/v1',
} as const

export const QWEN_BASE_URL_OPTIONS = [
  {
    label: '中国（华北2-北京） / China (Beijing)',
    value: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  {
    label: '新加坡（Singapore） / Singapore',
    value: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  },
  {
    label: '美国（Virginia） / US (Virginia)',
    value: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
  },
] as const
