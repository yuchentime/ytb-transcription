import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings, TranslateProvider, TtsProvider } from '../db/types'
import { GLM_TTS_MAX_INPUT_CHARS, QWEN_TTS_MAX_INPUT_CHARS, QWEN_TTS_MAX_INPUT_UTF8_BYTES } from './constants'
import { runCommand } from './command'
import { splitTextByPunctuationForTts } from './text-processing'

interface MiniMaxTextResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
}

interface OpenAIChatResponse {
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
  error?: {
    message?: string
    type?: string
    code?: string | number
  }
}

interface OpenAITtsResponse {
  audio_url?: string
  download_url?: string
  url?: string
  data?: string
}

interface QwenDashScopeTtsResponse {
  output?: {
    audio?: {
      url?: string
      data?: string
      format?: string
    }
  }
  code?: string
  message?: string
}

interface MiniMaxTtsCreateResponse {
  task_id?: string | number
  file_id?: number | string
  audio_file?: string
  audio_url?: string
  data?: {
    task_id?: string | number
    file_id?: number | string
    audio_file?: string
    audio_url?: string
  }
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
}

interface MiniMaxTtsQueryResponse {
  task_id?: string | number
  task_status?: string
  status?: string
  file_id?: number | string
  audio_file?: string
  audio_url?: string
  data?: {
    status?: string
    file_id?: number | string
    audio_file?: string
    audio_url?: string
  }
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
}

interface MiniMaxFileRetrieveResponse {
  file?: {
    download_url?: string
  }
  data?: {
    download_url?: string
  }
  download_url?: string
}

const DEFAULT_PIPER_INPUT_MAX_CHARS = 220
const FALLBACK_PIPER_INPUT_MAX_CHARS = 120
const PIPER_HF_MIRROR_ENDPOINT = 'https://hf-mirror.com'

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function buildPiperInputLines(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const baseLines = lines.length > 0 ? lines : [normalized]

  const chunks: string[] = []
  for (const line of baseLines) {
    const splitLines = splitTextByPunctuationForTts(line, maxChars)
    const candidates = splitLines.length > 0 ? splitLines : [line]
    for (const candidate of candidates) {
      const compact = candidate.replace(/\s+/g, ' ').trim()
      if (!compact) continue
      if (compact.length <= maxChars) {
        chunks.push(compact)
        continue
      }
      for (let cursor = 0; cursor < compact.length; cursor += maxChars) {
        const piece = compact.slice(cursor, cursor + maxChars).trim()
        if (piece) chunks.push(piece)
      }
    }
  }
  return chunks
}

function isPiperNoChannelsError(message: string): boolean {
  return message.includes('# channels not specified') || message.includes('wave.Error')
}

function isLegacyPythonWaveError(message: string): boolean {
  return /python3\.9[\\/](wave\.py|site-packages)/i.test(message)
}

function isPiperNetworkBootstrapError(message: string): boolean {
  return /(huggingface|hf_hub|Cannot send a request|SSL|Connection|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN)/i.test(
    message,
  )
}

async function hasBertBaseChineseCache(hfHome: string): Promise<boolean> {
  const hubDir = path.join(hfHome, 'hub')
  try {
    const entries = await fs.readdir(hubDir, { withFileTypes: true })
    return entries.some(
      (entry) =>
        entry.isDirectory() &&
        (entry.name === 'models--google-bert--bert-base-chinese' ||
          entry.name === 'models--bert-base-chinese'),
    )
  } catch {
    return false
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function buildHeaders(apiKey?: string): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }
  if (typeof apiKey === 'string' && apiKey.trim()) {
    return {
      ...headers,
      Authorization: `Bearer ${apiKey.trim()}`,
    }
  }
  return headers
}

function getTextEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v1/text/chatcompletion_v2`
}

function getOpenAICompatibleTextEndpoint(
  provider: Exclude<TranslateProvider, 'minimax'>,
  baseUrl: string,
): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith('/chat/completions')) {
    return normalized
  }
  if (provider === 'glm') {
    if (normalized.endsWith('/v4')) {
      return `${normalized}/chat/completions`
    }
    if (normalized.endsWith('/api/paas')) {
      return `${normalized}/v4/chat/completions`
    }
  }
  if (/\/v\d+$/i.test(normalized)) {
    return `${normalized}/chat/completions`
  }
  return `${normalized}/v1/chat/completions`
}

function getOpenAICompatibleTtsEndpoint(
  provider: Exclude<TtsProvider, 'minimax' | 'piper'>,
  baseUrl: string,
): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith('/audio/speech')) {
    return normalized
  }
  if (provider === 'glm') {
    if (normalized.endsWith('/v4')) {
      return `${normalized}/audio/speech`
    }
    if (normalized.endsWith('/api/paas')) {
      return `${normalized}/v4/audio/speech`
    }
  }
  if (/\/v\d+$/i.test(normalized)) {
    return `${normalized}/audio/speech`
  }
  return `${normalized}/v1/audio/speech`
}

function isQwenCompatibleModeBaseUrl(baseUrl: string): boolean {
  return normalizeBaseUrl(baseUrl).toLowerCase().includes('/compatible-mode/')
}

function getQwenDashScopeTtsEndpoint(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.endsWith('/api/v1/services/aigc/multimodal-generation/generation')) {
    return normalized
  }
  if (normalized.endsWith('/api/v1')) {
    return `${normalized}/services/aigc/multimodal-generation/generation`
  }
  return normalized
}

function getTtsCreateEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v1/t2a_async_v2`
}

function getTtsQueryEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v1/query/t2a_async_query_v2`
}

function getFileRetrieveEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v1/files/retrieve`
}

function ensureTranslateSettings(settings: AppSettings): void {
  if (!settings.translateModelId) {
    throw new Error('translateModelId is required')
  }
  const provider = settings.translateProvider ?? 'minimax'
  const baseUrl = resolveTranslateApiBaseUrl(settings, provider)
  if (!baseUrl.trim()) {
    throw new Error(`${provider} API base URL is required for translation`)
  }
  if (provider === 'custom') return
  const key = resolveTranslateApiKey(settings, provider)
  if (!key.trim()) {
    throw new Error(`${provider} API key is required for translation`)
  }
}

function ensureMiniMaxTtsSettings(settings: AppSettings): void {
  if (settings.ttsProvider && settings.ttsProvider !== 'minimax') {
    throw new Error(`TTS provider "${settings.ttsProvider}" is not supported by current task engine`)
  }
  if (!settings.minimaxApiKey) {
    throw new Error('MiniMax API key is required')
  }
  if (!settings.minimaxApiBaseUrl?.trim()) {
    throw new Error('MiniMax API base URL is required')
  }
  if (!settings.ttsModelId) {
    throw new Error('ttsModelId is required')
  }
}

function ensureTtsSettings(settings: AppSettings): void {
  const provider = settings.ttsProvider ?? 'minimax'
  if (provider === 'piper') {
    if (!settings.piperModelPath?.trim()) {
      throw new Error('piperModelPath is required for Piper TTS')
    }
    return
  }
  if (!settings.ttsModelId) {
    throw new Error('ttsModelId is required')
  }
  const baseUrl = resolveTtsApiBaseUrl(settings, provider)
  if (!baseUrl.trim()) {
    throw new Error(`${provider} API base URL is required for TTS`)
  }
  const key = resolveTtsApiKey(settings, provider)
  if (!key.trim()) {
    throw new Error(`${provider} API key is required for TTS`)
  }
}

function resolveTranslateApiKey(
  settings: AppSettings,
  provider: TranslateProvider,
): string {
  switch (provider) {
    case 'minimax':
      return settings.minimaxApiKey ?? ''
    case 'deepseek':
      return settings.deepseekApiKey ?? ''
    case 'glm':
      return settings.glmApiKey ?? ''
    case 'kimi':
      return settings.kimiApiKey ?? ''
    case 'custom':
      return settings.customApiKey ?? ''
  }
}

function resolveTranslateApiBaseUrl(
  settings: AppSettings,
  provider: TranslateProvider,
): string {
  switch (provider) {
    case 'minimax':
      return settings.minimaxApiBaseUrl ?? ''
    case 'deepseek':
      return settings.deepseekApiBaseUrl ?? ''
    case 'glm':
      return settings.glmApiBaseUrl ?? ''
    case 'kimi':
      return settings.kimiApiBaseUrl ?? ''
    case 'custom':
      return settings.customApiBaseUrl ?? ''
  }
}

function resolveTtsApiKey(
  settings: AppSettings,
  provider: TtsProvider,
): string {
  switch (provider) {
    case 'minimax':
      return settings.minimaxApiKey ?? ''
    case 'openai':
      return settings.openaiApiKey ?? ''
    case 'glm':
      return settings.glmApiKey ?? ''
    case 'qwen':
      return settings.qwenApiKey ?? ''
    case 'piper':
      return ''
  }
}

function resolveTtsApiBaseUrl(
  settings: AppSettings,
  provider: TtsProvider,
): string {
  switch (provider) {
    case 'minimax':
      return settings.minimaxApiBaseUrl ?? ''
    case 'openai':
      return settings.openaiApiBaseUrl ?? ''
    case 'glm':
      return settings.glmApiBaseUrl ?? ''
    case 'qwen':
      return settings.qwenApiBaseUrl ?? ''
    case 'piper':
      return ''
  }
}

function extractOpenAIChoiceContent(
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => (item?.type === 'text' ? item.text ?? '' : item?.text ?? ''))
    .join('')
    .trim()
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  const timeout =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : undefined
  if (!timeout) {
    return await fetch(input, init)
  }

  const controller = new AbortController()
  const fetchPromise = fetch(input, {
    ...init,
    signal: controller.signal,
  })
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort()
      reject(new Error(`Request timeout after ${timeout}ms`))
    }, timeout)
  })

  try {
    return await Promise.race([fetchPromise, timeoutPromise])
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`)
    }
    const message = error instanceof Error ? error.message : String(error)
    const cause = (error as { cause?: unknown } | null)?.cause
    const causeCode =
      cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
        ? cause.code
        : ''
    const causeMessage =
      cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string'
        ? cause.message
        : ''
    if (message === 'fetch failed') {
      const detail = [causeCode, causeMessage].filter(Boolean).join(' ')
      throw new Error(detail ? `fetch failed (${detail})` : 'fetch failed')
    }
    throw error
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

async function readJsonWithTimeout<T>(
  response: Response,
  timeoutMs?: number,
): Promise<T> {
  const timeout =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : undefined
  if (!timeout) {
    return (await response.json()) as T
  }

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Text response timeout after ${timeout}ms`))
    }, timeout)

    response
      .json()
      .then((data) => resolve(data as T))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timer))
  })
}

async function requestMiniMaxText(params: {
  settings: AppSettings
  timeoutMs?: number
  messages: Array<{ role: 'system' | 'user'; content: string }>
  action: 'translate' | 'polish'
}): Promise<string> {
  const response = await fetchWithTimeout(
    getTextEndpoint(params.settings.minimaxApiBaseUrl),
    {
      method: 'POST',
      headers: buildHeaders(params.settings.minimaxApiKey),
      body: JSON.stringify({
        model: params.settings.translateModelId,
        temperature:
          params.action === 'polish'
            ? Math.min(0.4, params.settings.translateTemperature ?? 0.3)
            : params.settings.translateTemperature ?? 0.3,
        messages: params.messages,
      }),
    },
    params.timeoutMs,
  )

  if (!response.ok) {
    throw new Error(`MiniMax text request failed: HTTP ${response.status}`)
  }

  const data = await readJsonWithTimeout<MiniMaxTextResponse>(response, params.timeoutMs)
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) {
    const code = data.base_resp?.status_code ?? 'unknown'
    const statusMsg = data.base_resp?.status_msg?.trim()
    throw new Error(
      statusMsg
        ? `MiniMax text response missing content (${code}): ${statusMsg}`
        : `MiniMax text response missing content (${code})`,
    )
  }
  return content
}

async function requestOpenAICompatibleText(params: {
  settings: AppSettings
  provider: Exclude<TranslateProvider, 'minimax'>
  timeoutMs?: number
  messages: Array<{ role: 'system' | 'user'; content: string }>
}): Promise<string> {
  const baseUrl = resolveTranslateApiBaseUrl(params.settings, params.provider)
  if (!baseUrl.trim()) {
    throw new Error(`${params.provider} API base URL is required for translation`)
  }
  const response = await fetchWithTimeout(
    getOpenAICompatibleTextEndpoint(params.provider, baseUrl),
    {
      method: 'POST',
      headers: buildHeaders(resolveTranslateApiKey(params.settings, params.provider)),
      body: JSON.stringify({
        model: params.settings.translateModelId,
        temperature: params.settings.translateTemperature ?? 0.3,
        messages: params.messages,
      }),
    },
    params.timeoutMs,
  )
  if (!response.ok) {
    throw new Error(`${params.provider} text request failed: HTTP ${response.status}`)
  }

  const data = await readJsonWithTimeout<OpenAIChatResponse>(response, params.timeoutMs)
  const firstChoice = data.choices?.[0]
  const finishReason = firstChoice?.finish_reason?.trim().toLowerCase()
  if (finishReason && finishReason !== 'stop') {
    throw new Error(`${params.provider} text response truncated (finish_reason=${finishReason})`)
  }
  const content = extractOpenAIChoiceContent(firstChoice?.message?.content)
  if (!content) {
    const detail =
      data.error?.message?.trim() ||
      data.error?.code?.toString().trim() ||
      data.error?.type?.trim() ||
      'unknown'
    throw new Error(`${params.provider} text response missing content (${detail})`)
  }
  return content
}

export async function translateText(params: {
  settings: AppSettings
  sourceText: string
  targetLanguage: string
  timeoutMs?: number
  context?: {
    previousText?: string
    segmentIndex?: number
    totalSegments?: number
  }
}): Promise<string> {
  ensureTranslateSettings(params.settings)
  const provider = params.settings.translateProvider ?? 'minimax'
  const previousText = params.context?.previousText?.trim() ?? ''
  const segmentIndex = params.context?.segmentIndex
  const totalSegments = params.context?.totalSegments
  const segmentPosition =
    typeof segmentIndex === 'number' && typeof totalSegments === 'number'
      ? `${segmentIndex + 1}/${totalSegments}`
      : null
  const messages = [
    {
      role: 'system' as const,
      content: [
        'You are a professional translator.',
        `Translate into ${params.targetLanguage}.`,
        segmentPosition ? `Current segment position: ${segmentPosition}.` : '',
        'Keep meaning faithful, concise, and natural.',
        'If previous context is provided, use it only for continuity.',
        'Never translate or repeat previous context.',
        'Output only the translation for the user message.',
        'Do not include explanations, labels, or extra lines.',
        previousText ? `Previous segment tail for context only:\n${previousText}` : '',
      ].join(' '),
    },
    {
      role: 'user' as const,
      content: params.sourceText,
    },
  ]

  if (provider === 'minimax') {
    return await requestMiniMaxText({
      settings: params.settings,
      timeoutMs: params.timeoutMs,
      messages,
      action: 'translate',
    })
  }
  return await requestOpenAICompatibleText({
    settings: params.settings,
    provider,
    timeoutMs: params.timeoutMs,
    messages,
  })
}

async function queryTtsUntilReady(params: {
  settings: AppSettings
  taskId: string
  timeoutMs: number
}): Promise<{ fileId?: string | number; audioUrl?: string }> {
  const start = Date.now()
  while (Date.now() - start < params.timeoutMs) {
    const url = new URL(getTtsQueryEndpoint(params.settings.minimaxApiBaseUrl))
    url.searchParams.set('task_id', params.taskId)
    const remainingMs = Math.max(5_000, params.timeoutMs - (Date.now() - start))
    const response = await fetchWithTimeout(
      url.toString(),
      {
        method: 'GET',
        headers: buildHeaders(params.settings.minimaxApiKey),
      },
      Math.min(30_000, remainingMs),
    )

    if (!response.ok) {
      throw new Error(`MiniMax tts query failed: HTTP ${response.status}`)
    }

    const data = (await response.json()) as MiniMaxTtsQueryResponse
    if (typeof data.base_resp?.status_code === 'number' && data.base_resp.status_code !== 0) {
      throw new Error(
        `MiniMax tts task query failed (${data.base_resp.status_msg ?? data.base_resp.status_code})`,
      )
    }

    const status = (data.data?.status ?? data.task_status ?? data.status ?? '').toLowerCase()
    if (status === 'success' || status === 'succeeded' || status === 'done' || status === 'completed') {
      return {
        fileId: data.data?.file_id ?? data.file_id,
        audioUrl: data.data?.audio_file ?? data.data?.audio_url ?? data.audio_file ?? data.audio_url,
      }
    }
    if (status === 'failed' || status === 'error' || status === 'expired') {
      throw new Error(`MiniMax tts task failed (${data.base_resp?.status_msg ?? 'unknown'})`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw new Error('MiniMax tts task query timeout')
}

async function resolveDownloadUrl(params: {
  settings: AppSettings
  fileId: string | number
}): Promise<string> {
  const url = new URL(getFileRetrieveEndpoint(params.settings.minimaxApiBaseUrl))
  url.searchParams.set('file_id', String(params.fileId))
  const response = await fetchWithTimeout(
    url.toString(),
    {
      method: 'GET',
      headers: buildHeaders(params.settings.minimaxApiKey),
    },
    30_000,
  )

  if (!response.ok) {
    throw new Error(`MiniMax file retrieve failed: HTTP ${response.status}`)
  }

  const data = (await response.json()) as MiniMaxFileRetrieveResponse
  const downloadUrl = data.file?.download_url ?? data.data?.download_url ?? data.download_url
  if (!downloadUrl) {
    throw new Error('MiniMax file retrieve response missing download_url')
  }
  return downloadUrl
}

async function requestOpenAICompatibleTts(params: {
  settings: AppSettings
  provider: Exclude<TtsProvider, 'minimax' | 'piper'>
  text: string
}): Promise<{ downloadUrl?: string; audioBuffer?: Buffer; extension?: string }> {
  const baseUrl = resolveTtsApiBaseUrl(params.settings, params.provider)
  if (!baseUrl.trim()) {
    throw new Error(`${params.provider} API base URL is required for TTS`)
  }
  const normalizedInput = params.text.trim()
  const fallbackVoice =
    params.provider === 'glm'
      ? 'tongtong'
      : params.provider === 'qwen'
        ? 'Cherry'
        : 'alloy'
  if (params.provider === 'glm' && normalizedInput.length > GLM_TTS_MAX_INPUT_CHARS) {
    throw new Error(
      `${params.provider} tts input exceeds hard limit before request (chars=${normalizedInput.length}, limit=${GLM_TTS_MAX_INPUT_CHARS}).`,
    )
  }
  const isQwenCompatibleMode =
    params.provider === 'qwen' ? isQwenCompatibleModeBaseUrl(baseUrl) : false
  if (params.provider === 'qwen' && !isQwenCompatibleMode) {
    const qwenInput = normalizedInput
    const qwenCharLength = qwenInput.length
    const qwenUtf8Bytes = Buffer.byteLength(qwenInput, 'utf8')
    if (qwenCharLength > QWEN_TTS_MAX_INPUT_CHARS || qwenUtf8Bytes > QWEN_TTS_MAX_INPUT_UTF8_BYTES) {
      throw new Error(
        `${params.provider} tts input exceeds hard limit before request (chars=${qwenCharLength}, utf8Bytes=${qwenUtf8Bytes}, charLimit=${QWEN_TTS_MAX_INPUT_CHARS}, utf8BytesLimit=${QWEN_TTS_MAX_INPUT_UTF8_BYTES}).`,
      )
    }
    const response = await fetchWithTimeout(
      getQwenDashScopeTtsEndpoint(baseUrl),
      {
        method: 'POST',
        headers: buildHeaders(resolveTtsApiKey(params.settings, params.provider)),
        body: JSON.stringify({
          model: params.settings.ttsModelId,
          input: {
            text: qwenInput,
            voice: params.settings.ttsVoiceId || fallbackVoice,
          },
        }),
      },
      Math.max(30_000, params.settings.stageTimeoutMs ?? 600_000),
    )

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(
        `${params.provider} tts request failed: HTTP ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`,
      )
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('application/json')) {
      const audioBuffer = Buffer.from(await response.arrayBuffer())
      if (audioBuffer.length === 0) {
        throw new Error(`${params.provider} tts response is empty`)
      }
      return { audioBuffer, extension: contentType.includes('wav') ? 'wav' : 'mp3' }
    }

    const data = (await response.json()) as QwenDashScopeTtsResponse
    const downloadUrl = data.output?.audio?.url
    if (downloadUrl) {
      return { downloadUrl }
    }
    const encodedAudio = data.output?.audio?.data
    if (typeof encodedAudio === 'string' && encodedAudio.trim()) {
      try {
        const decoded = Buffer.from(encodedAudio.trim(), 'base64')
        if (decoded.length > 0) {
          const format = data.output?.audio?.format?.toLowerCase()
          return { audioBuffer: decoded, extension: format === 'wav' ? 'wav' : 'mp3' }
        }
      } catch {
        // noop
      }
    }

    const detail = data.message || data.code || 'missing audio payload'
    throw new Error(`${params.provider} tts response invalid: ${detail}`)
  }

  const requestBody =
    params.provider === 'glm'
      ? {
          model: params.settings.ttsModelId,
          input: normalizedInput,
          voice: params.settings.ttsVoiceId || fallbackVoice,
          speed: Math.max(0.5, Math.min(2, params.settings.ttsSpeed ?? 1)),
          volume: Math.max(0.1, Math.min(10, params.settings.ttsVolume ?? 1)),
          stream: false,
          response_format: 'wav',
        }
      : {
          model: params.settings.ttsModelId,
          input: normalizedInput,
          voice: params.settings.ttsVoiceId || fallbackVoice,
          speed: params.settings.ttsSpeed ?? 1,
          response_format: 'mp3',
        }
  const endpoint = getOpenAICompatibleTtsEndpoint(params.provider, baseUrl)
  const requestTimeout = Math.max(30_000, params.settings.stageTimeoutMs ?? 600_000)
  const maxTransportAttempts = params.provider === 'glm' ? 2 : 1
  let response: Response | null = null
  let lastTransportError: unknown = null
  for (let attempt = 1; attempt <= maxTransportAttempts; attempt += 1) {
    try {
      response = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          headers: buildHeaders(resolveTtsApiKey(params.settings, params.provider)),
          body: JSON.stringify(requestBody),
        },
        requestTimeout,
      )
      break
    } catch (error) {
      lastTransportError = error
      const message = error instanceof Error ? error.message : String(error)
      const retryableTransportError =
        /fetch failed|timeout|network|econnreset|etimedout|enotfound|eai_again|socket/i.test(message)
      if (!retryableTransportError || attempt >= maxTransportAttempts) {
        throw error
      }
      const backoffMs = 400 * attempt
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  if (!response) {
    throw (lastTransportError instanceof Error
      ? lastTransportError
      : new Error(lastTransportError ? String(lastTransportError) : `${params.provider} tts request failed`))
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `${params.provider} tts request failed: HTTP ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`,
    )
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/json')) {
    const data = (await response.json()) as OpenAITtsResponse
    const downloadUrl = data.audio_url ?? data.download_url ?? data.url
    if (downloadUrl) {
      return { downloadUrl }
    }
    if (typeof data.data === 'string' && data.data.trim()) {
      try {
        const decoded = Buffer.from(data.data.trim(), 'base64')
        if (decoded.length > 0) {
          return { audioBuffer: decoded, extension: params.provider === 'glm' ? 'wav' : 'mp3' }
        }
      } catch {
        // noop
      }
    }
    throw new Error(`${params.provider} tts response missing audio payload`)
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer())
  if (audioBuffer.length === 0) {
    throw new Error(`${params.provider} tts response is empty`)
  }
  const extension =
    contentType.includes('wav')
      ? 'wav'
      : contentType.includes('mpeg')
        ? 'mp3'
        : params.provider === 'glm'
          ? 'wav'
          : 'mp3'
  return { audioBuffer, extension }
}

async function requestPiperTts(params: {
  settings: AppSettings
  text: string
}): Promise<{ audioBuffer: Buffer; extension: 'wav' }> {
  const platformToken = (() => {
    if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64'
    if (process.platform === 'darwin' && process.arch === 'x64') return 'darwin-x64'
    if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64'
    if (process.platform === 'win32' && process.arch === 'arm64') return 'win32-arm64'
    if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64'
    if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64'
    return null
  })()
  const binaryName = process.platform === 'win32' ? 'piper.exe' : 'piper'
  const resourceRoots = [
    process.resourcesPath,
    path.resolve(process.cwd(), 'resources'),
    process.env.APP_ROOT ? path.join(process.env.APP_ROOT, 'resources') : '',
  ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0)

  const resolveBundledPiperPath = async (): Promise<string | null> => {
    const candidates: string[] = []
    for (const root of resourceRoots) {
      if (platformToken) {
        candidates.push(path.join(root, 'piper', platformToken, binaryName))
      }
      candidates.push(path.join(root, 'piper', binaryName))
    }

    for (const candidate of candidates) {
      try {
        await fs.access(candidate)
        if (process.platform !== 'win32') {
          await fs.chmod(candidate, 0o755).catch(() => undefined)
        }
        return candidate
      } catch {
        // continue
      }
    }
    return null
  }

  const resolveModelPath = async (): Promise<string> => {
    const raw = params.settings.piperModelPath.trim()
    if (!raw) {
      throw new Error('piperModelPath is required for Piper TTS')
    }

    const candidates = path.isAbsolute(raw)
      ? [raw]
      : [
          path.resolve(process.cwd(), raw),
          ...resourceRoots.map((root) => path.join(root, 'piper', 'models', raw)),
          ...resourceRoots.map((root) => path.join(root, raw)),
        ]
    for (const candidate of candidates) {
      try {
        await fs.access(candidate)
        return candidate
      } catch {
        // continue
      }
    }
    throw new Error(`Piper model not found: ${raw}`)
  }

  const configuredCommand = params.settings.piperExecutablePath.trim()
  const bundledCommand = await resolveBundledPiperPath()
  const command = configuredCommand || bundledCommand || 'piper'
  const modelPath = await resolveModelPath()
  if (!modelPath) {
    throw new Error('piperModelPath is required for Piper TTS')
  }

  const configuredConfigPath = params.settings.piperConfigPath.trim()
  const inferredConfigPath = `${modelPath}.json`
  const candidateConfigPaths =
    configuredConfigPath.length > 0
      ? path.isAbsolute(configuredConfigPath)
        ? [configuredConfigPath]
        : [
            path.resolve(process.cwd(), configuredConfigPath),
            ...resourceRoots.map((root) => path.join(root, 'piper', 'models', configuredConfigPath)),
            ...resourceRoots.map((root) => path.join(root, configuredConfigPath)),
          ]
      : [inferredConfigPath]

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'piper-tts-'))
  const outputPath = path.join(tempDir, 'segment.wav')
  const inputPath = path.join(tempDir, 'segment.txt')
  const dataDir = path.join(path.dirname(modelPath), '.piper-data')
  await fs.mkdir(dataDir, { recursive: true }).catch(() => undefined)
  const argsBase = ['--model', modelPath, '--output_file', outputPath]

  for (const configPath of candidateConfigPaths) {
    try {
      await fs.access(configPath)
      argsBase.push('--config', configPath)
      break
    } catch {
      // continue
    }
  }

  const speakerArgs =
    Number.isFinite(params.settings.piperSpeakerId) && params.settings.piperSpeakerId >= 0
      ? ['--speaker', String(Math.floor(params.settings.piperSpeakerId))]
      : []

  const lengthScale = Number.isFinite(params.settings.piperLengthScale)
    ? Math.max(0.1, params.settings.piperLengthScale)
    : 1
  const noiseScale = Number.isFinite(params.settings.piperNoiseScale)
    ? Math.max(0, params.settings.piperNoiseScale)
    : 0.667
  const noiseW = Number.isFinite(params.settings.piperNoiseW)
    ? Math.max(0, params.settings.piperNoiseW)
    : 0.8

  argsBase.push('--length_scale', String(lengthScale))
  argsBase.push('--noise_scale', String(noiseScale))
  argsBase.push('--noise_w', String(noiseW))
  argsBase.push('--data-dir', dataDir)
  const normalizedText = params.text.trim()
  const maxCharsPlans = [DEFAULT_PIPER_INPUT_MAX_CHARS, FALLBACK_PIPER_INPUT_MAX_CHARS]
  const hfHome = path.join(dataDir, '.hf-cache')
  await fs.mkdir(hfHome, { recursive: true }).catch(() => undefined)
  const piperIsChineseModel = /^zh_/i.test(path.basename(modelPath))
  const g2pwModelPath = path.join(dataDir, 'g2pW', 'g2pw.onnx')
  const requiresChineseBootstrap =
    piperIsChineseModel &&
    (!(await pathExists(g2pwModelPath)) || !(await hasBertBaseChineseCache(hfHome)))
  const piperRuntimeEnvBase: NodeJS.ProcessEnv = {
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    HF_HOME: hfHome,
    TRANSFORMERS_CACHE: path.join(hfHome, 'transformers'),
  }
  const configuredHfEndpoint = (process.env.HF_ENDPOINT ?? '').trim()
  const runtimeEnvPlans: NodeJS.ProcessEnv[] = configuredHfEndpoint
    ? [
        {
          ...piperRuntimeEnvBase,
          HF_ENDPOINT: configuredHfEndpoint,
        },
      ]
    : [
        piperRuntimeEnvBase,
        {
          ...piperRuntimeEnvBase,
          HF_ENDPOINT: PIPER_HF_MIRROR_ENDPOINT,
        },
      ]

  try {
    if (!normalizedText) {
      throw new Error('Piper text is empty')
    }

    if (requiresChineseBootstrap) {
      const bootstrapInputPath = path.join(tempDir, 'bootstrap.txt')
      const bootstrapText = '这是 Piper 运行环境健康检查。'
      await fs.writeFile(bootstrapInputPath, `${bootstrapText}\n`, 'utf8')
      const bootstrapArgs = [...argsBase, '--input_file', bootstrapInputPath]
      const bootstrapTimeoutMs = Math.max(15 * 60 * 1000, params.settings.stageTimeoutMs ?? 600_000)
      let bootstrapError: unknown = null

      for (let envIndex = 0; envIndex < runtimeEnvPlans.length; envIndex += 1) {
        try {
          await runCommand({
            command,
            args: bootstrapArgs,
            cwd: dataDir,
            env: runtimeEnvPlans[envIndex],
            timeoutMs: bootstrapTimeoutMs,
          })
          bootstrapError = null
          break
        } catch (error) {
          bootstrapError = error
          const message = error instanceof Error ? error.message : String(error)
          if (isPiperNetworkBootstrapError(message) && envIndex < runtimeEnvPlans.length - 1) {
            continue
          }
          throw error
        }
      }

      if (bootstrapError) {
        throw bootstrapError
      }
    }

    let lastNoChannelsError: unknown = null
    for (let index = 0; index < maxCharsPlans.length; index += 1) {
      const maxChars = maxCharsPlans[index]
      const inputLines = buildPiperInputLines(normalizedText, maxChars)
      if (inputLines.length === 0) {
        throw new Error('Piper text is empty after normalization')
      }

      const runArgPlans =
        speakerArgs.length > 0 ? [[...argsBase, ...speakerArgs], argsBase] : [argsBase]
      await fs.writeFile(inputPath, `${inputLines.join('\n')}\n`, 'utf8')

      for (let planIndex = 0; planIndex < runArgPlans.length; planIndex += 1) {
        for (let envIndex = 0; envIndex < runtimeEnvPlans.length; envIndex += 1) {
          try {
            await runCommand({
              command,
              args: [...runArgPlans[planIndex], '--input_file', inputPath],
              cwd: dataDir,
              env: runtimeEnvPlans[envIndex],
              timeoutMs: Math.max(30_000, params.settings.stageTimeoutMs ?? 600_000),
            })
            const audioBuffer = await fs.readFile(outputPath)
            if (audioBuffer.length === 0) {
              throw new Error('Piper output is empty')
            }
            return { audioBuffer, extension: 'wav' }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const isNoChannels = isPiperNoChannelsError(message)
            const isNetworkBootstrap = isPiperNetworkBootstrapError(message)
            const isLastArgsPlan = planIndex >= runArgPlans.length - 1
            const isLastEnvPlan = envIndex >= runtimeEnvPlans.length - 1
            const isLastMaxCharsPlan = index >= maxCharsPlans.length - 1

            if ((isNoChannels || isNetworkBootstrap) && !isLastEnvPlan) {
              continue
            }
            if (isNoChannels && !isLastArgsPlan) {
              continue
            }
            if (!isNoChannels || isLastMaxCharsPlan) {
              throw error
            }
            lastNoChannelsError = error
            break
          }
        }
      }
    }

    if (lastNoChannelsError) {
      throw lastNoChannelsError
    }
    throw new Error('Piper output is empty')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const missingModuleMatch = message.match(/No module named '([^']+)'/)
    if (missingModuleMatch && missingModuleMatch[1]) {
      const missingModule = missingModuleMatch[1]
      const suggestedPython =
        command.includes(path.sep) && command.endsWith(process.platform === 'win32' ? 'piper.exe' : 'piper')
          ? path.join(
              path.dirname(command),
              process.platform === 'win32' ? 'python.exe' : 'python',
            )
          : process.platform === 'win32'
            ? 'python'
            : 'python3'
      throw new Error(
        `Piper tts failed: missing Python module "${missingModule}". Reinstall Piper runtime in Settings -> 本地语音合成（Piper） or run "${suggestedPython} -m pip install ${missingModule}" and retry.`,
      )
    }
    if (isPiperNoChannelsError(message)) {
      const versionHint = isLegacyPythonWaveError(message)
        ? ' Detected legacy Python 3.9 runtime; please reinstall Piper runtime to rebuild venv with managed Python.'
        : ''
      throw new Error(
        `Piper tts failed: model produced empty audio frames. Try reinstalling Piper runtime/model and retry.${versionHint} Raw error: ${message}`,
      )
    }
    throw new Error(`Piper tts failed: ${message}`)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function synthesizeSpeech(params: {
  settings: AppSettings
  text: string
}): Promise<{ downloadUrl?: string; audioBuffer?: Buffer; extension?: string }> {
  ensureTtsSettings(params.settings)
  const provider = params.settings.ttsProvider ?? 'minimax'
  if (provider === 'piper') {
    return await requestPiperTts({
      settings: params.settings,
      text: params.text,
    })
  }
  if (provider !== 'minimax') {
    return await requestOpenAICompatibleTts({
      settings: params.settings,
      provider,
      text: params.text,
    })
  }

  ensureMiniMaxTtsSettings(params.settings)
  const createResponse = await fetchWithTimeout(
    getTtsCreateEndpoint(params.settings.minimaxApiBaseUrl),
    {
      method: 'POST',
      headers: buildHeaders(params.settings.minimaxApiKey),
      body: JSON.stringify({
        model: params.settings.ttsModelId,
        text: params.text,
        voice_setting: {
          voice_id: params.settings.ttsVoiceId,
          speed: params.settings.ttsSpeed ?? 1,
          pitch: params.settings.ttsPitch ?? 0,
          vol: params.settings.ttsVolume ?? 1,
        },
        audio_setting: {
          audio_sample_rate: 32000,
          bitrate: 128000,
          format: 'mp3',
        },
      }),
    },
    Math.min(120_000, Math.max(30_000, params.settings.stageTimeoutMs ?? 600_000)),
  )

  if (!createResponse.ok) {
    throw new Error(`MiniMax tts create failed: HTTP ${createResponse.status}`)
  }

  const data = (await createResponse.json()) as MiniMaxTtsCreateResponse
  if (typeof data.base_resp?.status_code === 'number' && data.base_resp.status_code !== 0) {
    throw new Error(`MiniMax tts create failed (${data.base_resp.status_msg ?? data.base_resp.status_code})`)
  }

  if (data.data?.audio_file || data.data?.audio_url || data.audio_file || data.audio_url) {
    return { downloadUrl: data.data?.audio_file ?? data.data?.audio_url ?? data.audio_file ?? data.audio_url ?? '' }
  }

  const taskId = data.task_id ?? data.data?.task_id
  if (!taskId) {
    throw new Error('MiniMax tts response missing task_id')
  }

  const queryResult = await queryTtsUntilReady({
    settings: params.settings,
    taskId: String(taskId),
    timeoutMs: Math.max(30_000, params.settings.stageTimeoutMs ?? 600_000),
  })

  if (queryResult.audioUrl) {
    return { downloadUrl: queryResult.audioUrl }
  }
  if (queryResult.fileId !== undefined) {
    const url = await resolveDownloadUrl({
      settings: params.settings,
      fileId: queryResult.fileId,
    })
    return { downloadUrl: url }
  }

  throw new Error('MiniMax tts query finished without file url')
}
