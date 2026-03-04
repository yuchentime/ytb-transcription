// Translate provider base URLs (for translation service)
export const TRANSLATE_BASE_URLS = {
  minimax: 'https://api.minimaxi.com',
  deepseek: 'https://api.deepseek.com/chat/completions',
  glm: 'https://open.bigmodel.cn/api/paas',
  kimi: 'https://api.moonshot.cn/v1',
} as const

// TTS provider base URLs (for text-to-speech service)
export const TTS_BASE_URLS = {
  minimax: 'https://api.minimaxi.com',
  openai: 'https://api.openai.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas',
  qwen: 'https://dashscope.aliyuncs.com/api/v1',
} as const

// Qwen region-specific base URLs for TTS
export const QWEN_REGION_BASE_URLS = {
  cn: TTS_BASE_URLS.qwen,
  sg: 'https://dashscope-intl.aliyuncs.com/api/v1',
  us: 'https://dashscope-us.aliyuncs.com/api/v1',
} as const

// Default custom API base URL for custom translation provider
export const DEFAULT_CUSTOM_API_BASE_URL = 'http://localhost:1234/v1'

// @deprecated Use TRANSLATE_BASE_URLS or TTS_BASE_URLS instead
export const PROVIDER_BASE_URLS = {
  ...TRANSLATE_BASE_URLS,
  openai: TTS_BASE_URLS.openai,
  qwen: TTS_BASE_URLS.qwen,
} as const
