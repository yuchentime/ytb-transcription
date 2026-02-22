import type { AppSettings, TranslateProvider, TtsProvider } from '../db/types'

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
  provider: Exclude<TtsProvider, 'minimax'>,
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

function ensureMiniMaxTtsSettings(settings: AppSettings & { minimaxApiBaseUrl: string }): void {
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
  if (!settings.ttsModelId) {
    throw new Error('ttsModelId is required')
  }
  const provider = settings.ttsProvider ?? 'minimax'
  const baseUrl = resolveTtsApiBaseUrl(settings, provider)
  if (!baseUrl.trim()) {
    throw new Error(`${provider} API base URL is required for TTS`)
  }
  if (provider === 'custom') return
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
    case 'glm':
      return settings.glmApiKey ?? ''
    case 'custom':
      return settings.customApiKey ?? ''
  }
}

function resolveTtsApiBaseUrl(
  settings: AppSettings,
  provider: TtsProvider,
): string {
  switch (provider) {
    case 'minimax':
      return settings.minimaxApiBaseUrl ?? ''
    case 'glm':
      return settings.glmApiBaseUrl ?? ''
    case 'custom':
      return settings.customApiBaseUrl ?? ''
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
      reject(new Error(`Text request timeout after ${timeout}ms`))
    }, timeout)
  })

  try {
    return await Promise.race([fetchPromise, timeoutPromise])
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Text request timeout after ${timeout}ms`)
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
  const content = extractOpenAIChoiceContent(data.choices?.[0]?.message?.content)
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

export async function minimaxTranslate(params: {
  settings: AppSettings & { minimaxApiBaseUrl: string }
  sourceText: string
  targetLanguage: string
  timeoutMs?: number
  context?: {
    previousText?: string
    nextText?: string
    segmentIndex?: number
    totalSegments?: number
  }
}): Promise<string> {
  ensureTranslateSettings(params.settings)
  const provider = params.settings.translateProvider ?? 'minimax'
  const previousText = params.context?.previousText?.trim() ?? ''
  const nextText = params.context?.nextText?.trim() ?? ''
  const segmentIndex = params.context?.segmentIndex
  const totalSegments = params.context?.totalSegments
  const messages = [
    {
      role: 'system' as const,
      content: [
        'You are a professional translator.',
        'Keep meaning faithful, concise, and natural.',
        'If context is provided, use it only for continuity.',
        'Output only the translation for CURRENT_SEGMENT.',
        'Do not include explanations, labels, or extra lines.',
      ].join(' '),
    },
    {
      role: 'user' as const,
      content: [
        `Target language: ${params.targetLanguage}`,
        typeof segmentIndex === 'number' && typeof totalSegments === 'number'
          ? `Segment position: ${segmentIndex + 1}/${totalSegments}`
          : '',
        previousText ? `PREVIOUS_CONTEXT:\n${previousText}` : '',
        `CURRENT_SEGMENT:\n${params.sourceText}`,
        nextText ? `NEXT_CONTEXT:\n${nextText}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
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

export async function minimaxPolish(params: {
  settings: AppSettings & { minimaxApiBaseUrl: string }
  sourceText: string
  targetLanguage: string
  timeoutMs?: number
  context?: {
    previousText?: string
    nextText?: string
  }
}): Promise<string> {
  ensureTranslateSettings(params.settings)
  const provider = params.settings.translateProvider ?? 'minimax'
  const previousText = params.context?.previousText?.trim() ?? ''
  const nextText = params.context?.nextText?.trim() ?? ''
  const messages = [
    {
      role: 'system' as const,
      content: [
        'You are a translation editor.',
        'Polish the CURRENT_SEGMENT in the same target language for coherence and readability.',
        'Keep original meaning, names, numbers, and terminology.',
        'Use context only for continuity.',
        'Output only polished CURRENT_SEGMENT text.',
      ].join(' '),
    },
    {
      role: 'user' as const,
      content: [
        `Target language: ${params.targetLanguage}`,
        previousText ? `PREVIOUS_CONTEXT:\n${previousText}` : '',
        `CURRENT_SEGMENT:\n${params.sourceText}`,
        nextText ? `NEXT_CONTEXT:\n${nextText}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ]

  if (provider === 'minimax') {
    return await requestMiniMaxText({
      settings: params.settings,
      timeoutMs: params.timeoutMs,
      messages,
      action: 'polish',
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
  settings: AppSettings & { minimaxApiBaseUrl: string }
  taskId: string
  timeoutMs: number
}): Promise<{ fileId?: string | number; audioUrl?: string }> {
  const start = Date.now()
  while (Date.now() - start < params.timeoutMs) {
    const url = new URL(getTtsQueryEndpoint(params.settings.minimaxApiBaseUrl))
    url.searchParams.set('task_id', params.taskId)
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: buildHeaders(params.settings.minimaxApiKey),
    })

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
  settings: AppSettings & { minimaxApiBaseUrl: string }
  fileId: string | number
}): Promise<string> {
  const url = new URL(getFileRetrieveEndpoint(params.settings.minimaxApiBaseUrl))
  url.searchParams.set('file_id', String(params.fileId))
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: buildHeaders(params.settings.minimaxApiKey),
  })

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
  provider: Exclude<TtsProvider, 'minimax'>
  text: string
}): Promise<{ downloadUrl?: string; audioBuffer?: Buffer; extension?: string }> {
  const baseUrl = resolveTtsApiBaseUrl(params.settings, params.provider)
  if (!baseUrl.trim()) {
    throw new Error(`${params.provider} API base URL is required for TTS`)
  }
  const response = await fetchWithTimeout(
    getOpenAICompatibleTtsEndpoint(params.provider, baseUrl),
    {
      method: 'POST',
      headers: buildHeaders(resolveTtsApiKey(params.settings, params.provider)),
      body: JSON.stringify({
        model: params.settings.ttsModelId,
        input: params.text,
        voice: params.settings.ttsVoiceId || 'alloy',
        speed: params.settings.ttsSpeed ?? 1,
        response_format: 'mp3',
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
          return { audioBuffer: decoded, extension: 'mp3' }
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
  const extension = contentType.includes('wav') ? 'wav' : contentType.includes('mpeg') ? 'mp3' : 'mp3'
  return { audioBuffer, extension }
}

export async function minimaxSynthesize(params: {
  settings: AppSettings & { minimaxApiBaseUrl: string }
  text: string
}): Promise<{ downloadUrl?: string; audioBuffer?: Buffer; extension?: string }> {
  ensureTtsSettings(params.settings)
  const provider = params.settings.ttsProvider ?? 'minimax'
  if (provider !== 'minimax') {
    return await requestOpenAICompatibleTts({
      settings: params.settings,
      provider,
      text: params.text,
    })
  }

  ensureMiniMaxTtsSettings(params.settings)
  const createResponse = await fetch(getTtsCreateEndpoint(params.settings.minimaxApiBaseUrl), {
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
  })

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
