export const PROVIDER_BASE_URLS = {
  minimax: 'https://api.minimaxi.com',
  deepseek: 'https://api.deepseek.com',
  glm: 'https://open.bigmodel.cn/api/paas',
  openai: 'https://api.openai.com/v1',
  qwen: 'https://dashscope.aliyuncs.com/api/v1',
  kimi: 'https://api.moonshot.cn/v1',
} as const

export const QWEN_REGION_BASE_URLS = {
  cn: PROVIDER_BASE_URLS.qwen,
  sg: 'https://dashscope-intl.aliyuncs.com/api/v1',
  us: 'https://dashscope-us.aliyuncs.com/api/v1',
} as const

export const DEFAULT_CUSTOM_API_BASE_URL = 'http://localhost:1234/v1'
