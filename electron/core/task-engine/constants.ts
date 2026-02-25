import type { StepName } from '../db/types'

/**
 * Pipeline stages in execution order.
 */
export const STAGES: StepName[] = [
  'downloading',
  'extracting',
  'transcribing',
  'translating',
  'synthesizing',
  'merging',
]

/**
 * Whisper model download URLs (OpenAI official).
 */
export const WHISPER_MODEL_URLS: Record<string, string> = {
  tiny: 'https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt',
  base: 'https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt',
  small:
    'https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt',
  medium:
    'https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt',
  large:
    'https://openaipublic.azureedge.net/main/whisper/models/e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb/large-v3.pt',
}

/**
 * MLX Whisper model repositories (HuggingFace).
 */
export const MLX_MODEL_REPOS: Record<string, string[]> = {
  tiny: ['mlx-community/whisper-tiny-mlx', 'mlx-community/whisper-tiny'],
  base: ['mlx-community/whisper-base-mlx', 'mlx-community/whisper-base'],
  small: ['mlx-community/whisper-small-mlx', 'mlx-community/whisper-small'],
  medium: ['mlx-community/whisper-medium-mlx', 'mlx-community/whisper-medium'],
  large: ['mlx-community/whisper-large-v3-turbo'],
}

// Translation defaults
export const DEFAULT_TRANSLATION_CONTEXT_CHARS = 160
export const DEFAULT_TRANSLATE_REQUEST_TIMEOUT_MS = 120 * 1000
export const DEFAULT_TRANSLATE_CONTEXT_WINDOW_TOKENS = 256_000
export const DEFAULT_TRANSLATE_SPLIT_THRESHOLD_RATIO = 0.7
export const DEFAULT_TRANSLATE_SPLIT_THRESHOLD_TOKENS = 8_000
export const DEFAULT_TRANSLATE_MIN_CHUNK_CHARS = 1_200

// TTS defaults
export const DEFAULT_TTS_SPLIT_THRESHOLD_CHARS = 3_000
export const DEFAULT_TTS_TARGET_SEGMENT_CHARS = 900
export const GLM_TTS_MAX_INPUT_CHARS = 1024
export const QWEN_TTS_MAX_INPUT_CHARS = 600
export const QWEN_TTS_MAX_INPUT_UTF8_BYTES = 600
export const QWEN_TTS_MAX_INPUT_TOKENS = 512

// Polish defaults
export const DEFAULT_POLISH_CONTEXT_CHARS = 180
export const DEFAULT_POLISH_TARGET_SEGMENT_LENGTH = 900
export const DEFAULT_POLISH_MIN_DURATION_SEC = 10 * 60

// Transcribe chunk defaults
export const DEFAULT_TRANSCRIBE_CHUNK_ENABLED = true
export const DEFAULT_TRANSCRIBE_CHUNK_MIN_DURATION_SEC = 10 * 60
export const DEFAULT_TRANSCRIBE_CHUNK_DURATION_SEC = 4 * 60
export const DEFAULT_TRANSCRIBE_CHUNK_OVERLAP_SEC = 1.2
export const DEFAULT_TRANSCRIBE_CONCURRENCY = 2

/**
 * Proxy environment variable keys.
 */
export const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
] as const
