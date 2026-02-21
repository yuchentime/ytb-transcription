import type { AppSettings } from '../db/types'

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

function buildHeaders(apiKey: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

function getTextEndpoint(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/v1/text/chatcompletion_v2`
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

function ensureApiSettings(settings: AppSettings & { minimaxApiBaseUrl: string }): void {
  if (!settings.minimaxApiKey) {
    throw new Error('MiniMax API key is required')
  }
  if (!settings.translateModelId) {
    throw new Error('translateModelId is required')
  }
  if (!settings.ttsModelId) {
    throw new Error('ttsModelId is required')
  }
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
      reject(new Error(`MiniMax text request timeout after ${timeout}ms`))
    }, timeout)
  })

  try {
    return await Promise.race([fetchPromise, timeoutPromise])
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`MiniMax text request timeout after ${timeout}ms`)
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
      reject(new Error(`MiniMax text response timeout after ${timeout}ms`))
    }, timeout)

    response
      .json()
      .then((data) => resolve(data as T))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timer))
  })
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
  ensureApiSettings(params.settings)
  const previousText = params.context?.previousText?.trim() ?? ''
  const nextText = params.context?.nextText?.trim() ?? ''
  const segmentIndex = params.context?.segmentIndex
  const totalSegments = params.context?.totalSegments

  const response = await fetchWithTimeout(
    getTextEndpoint(params.settings.minimaxApiBaseUrl),
    {
    method: 'POST',
    headers: buildHeaders(params.settings.minimaxApiKey),
    body: JSON.stringify({
      model: params.settings.translateModelId,
      temperature: params.settings.translateTemperature ?? 0.3,
      messages: [
        {
          role: 'system',
          content:
            [
              'You are a professional translator.',
              'Keep meaning faithful, concise, and natural.',
              'If context is provided, use it only for continuity.',
              'Output only the translation for CURRENT_SEGMENT.',
              'Do not include explanations, labels, or extra lines.',
            ].join(' '),
        },
        {
          role: 'user',
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
      ],
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
    throw new Error(
      `MiniMax text response missing content (${data.base_resp?.status_code ?? 'unknown'})`,
    )
  }
  return content
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
  ensureApiSettings(params.settings)
  const previousText = params.context?.previousText?.trim() ?? ''
  const nextText = params.context?.nextText?.trim() ?? ''
  const response = await fetchWithTimeout(
    getTextEndpoint(params.settings.minimaxApiBaseUrl),
    {
    method: 'POST',
    headers: buildHeaders(params.settings.minimaxApiKey),
    body: JSON.stringify({
      model: params.settings.translateModelId,
      temperature: Math.min(0.4, params.settings.translateTemperature ?? 0.3),
      messages: [
        {
          role: 'system',
          content: [
            'You are a translation editor.',
            'Polish the CURRENT_SEGMENT in the same target language for coherence and readability.',
            'Keep original meaning, names, numbers, and terminology.',
            'Use context only for continuity.',
            'Output only polished CURRENT_SEGMENT text.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            `Target language: ${params.targetLanguage}`,
            previousText ? `PREVIOUS_CONTEXT:\n${previousText}` : '',
            `CURRENT_SEGMENT:\n${params.sourceText}`,
            nextText ? `NEXT_CONTEXT:\n${nextText}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    }),
    },
    params.timeoutMs,
  )

  if (!response.ok) {
    throw new Error(`MiniMax polish request failed: HTTP ${response.status}`)
  }

  const data = await readJsonWithTimeout<MiniMaxTextResponse>(response, params.timeoutMs)
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new Error(
      `MiniMax polish response missing content (${data.base_resp?.status_code ?? 'unknown'})`,
    )
  }
  return content
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

export async function minimaxSynthesize(params: {
  settings: AppSettings & { minimaxApiBaseUrl: string }
  text: string
}): Promise<{ downloadUrl: string }> {
  ensureApiSettings(params.settings)
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
