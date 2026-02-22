import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { StepName, SegmentStageName, TaskStatus } from '../db/types'
import type { Toolchain } from './toolchain'
import { STAGES, PROXY_ENV_KEYS } from './constants'

/**
 * Convert stage name to task status.
 */
export function stageToStatus(stage: StepName): TaskStatus {
  return stage
}

/**
 * Check if status is a running state.
 */
export function isRunningStatus(status: TaskStatus): boolean {
  return (
    status === 'queued' ||
    status === 'downloading' ||
    status === 'extracting' ||
    status === 'transcribing' ||
    status === 'translating' ||
    status === 'synthesizing' ||
    status === 'merging'
  )
}

/**
 * Parse percentage from yt-dlp output.
 */
export function parsePercent(line: string): number | null {
  const match = line.match(/(\d{1,3}(?:\.\d+)?)%/)
  if (!match) return null
  const value = Number(match[1])
  if (Number.isNaN(value)) return null
  return Math.max(0, Math.min(100, Math.round(value)))
}

/**
 * Parse download speed from yt-dlp output.
 * Matches formats like: "at 2.5MiB/s", "at  24KB/s", "at 3.2 MB/s"
 */
export function parseDownloadSpeed(line: string): string | null {
  const match = line.match(/at\s+(\d+\.?\d*)\s*(KiB|MiB|KB|MB|GiB|GB)\/s/i)
  if (!match) return null
  const value = match[1]
  const unit = match[2]
  return `${value} ${unit}/s`
}

/**
 * Parse detected language from Whisper JSON output.
 */
export function parseWhisperDetectedLanguage(jsonContent: string): string | null {
  try {
    const parsed = JSON.parse(jsonContent) as { language?: unknown }
    return typeof parsed.language === 'string' ? parsed.language : null
  } catch {
    return null
  }
}

/**
 * Check if error suggests retrying with TV client.
 */
export function shouldRetryWithTvClient(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('requested format is not available') ||
    lower.includes('only images are available') ||
    lower.includes('n challenge solving failed')
  )
}

/**
 * Select appropriate Whisper device based on runtime availability.
 */
export function selectWhisperDevice(
  runtime: Toolchain['whisperRuntime'],
  model: string | null,
): 'cpu' | 'cuda' | 'mps' {
  if (runtime.cudaAvailable) return 'cuda'
  if (!runtime.mpsAvailable) return 'cpu'

  // For tiny/base models, CPU can be faster due to GPU scheduling overhead.
  if (model === 'tiny' || model === 'base') return 'cpu'
  return 'mps'
}

/**
 * Select transcription backend based on runtime and model.
 */
export function selectTranscribeBackend(
  runtime: Toolchain['whisperRuntime'],
  model: string | null,
): 'mlx' | 'openai-whisper' {
  if (
    process.platform === 'darwin' &&
    process.arch === 'arm64' &&
    runtime.mlxAvailable &&
    model !== 'tiny'
  ) {
    return 'mlx'
  }
  return 'openai-whisper'
}

/**
 * Check if any proxy environment variables are set.
 */
export function hasProxyEnv(): boolean {
  return PROXY_ENV_KEYS.some((key) => {
    const value = process.env[key]
    return typeof value === 'string' && value.trim().length > 0
  })
}

/**
 * Check if stderr output suggests a proxy TLS error.
 */
export function isLikelyProxyTlsError(stderrLines: string[]): boolean {
  const joined = stderrLines.join('\n').toLowerCase()
  return (
    joined.includes('http_proxy') ||
    joined.includes('proxyerror') ||
    joined.includes('connecterror') ||
    joined.includes('unexpected_eof_while_reading')
  )
}

/**
 * Download a file from URL to local path.
 */
export async function downloadToFile(url: string, filePath: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  let response: Response
  try {
    response = await fetch(url, { signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Download timeout after 60000ms')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`)
  }
  const content = Buffer.from(await response.arrayBuffer())
  const fs = await import('node:fs/promises')
  await fs.writeFile(filePath, content)
}

/**
 * Download file using streaming pipeline.
 */
export async function downloadFileStream(url: string, filePath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`)
  }
  if (!response.body) {
    throw new Error('Download failed: empty response stream')
  }
  const { createWriteStream } = await import('node:fs')
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(filePath))
}

/**
 * Parse Whisper model hash from download URL.
 */
export function parseWhisperModelHashFromUrl(url: string): string | null {
  const pathname = new URL(url).pathname
  const segments = pathname.split('/').filter(Boolean)
  const hash = segments[segments.length - 2] ?? ''
  return /^[a-f0-9]{64}$/i.test(hash) ? hash.toLowerCase() : null
}

/**
 * Compute SHA256 hash of a file.
 */
export async function computeSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: string | Buffer) => hash.update(typeof chunk === 'string' ? Buffer.from(chunk) : chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve())
  })
  return hash.digest('hex')
}

/**
 * Sleep for specified milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Checkpoint-related types and utilities
export type CheckpointComparableValue = string | number | boolean | null

/**
 * Check if value is a plain object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toComparableNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function toComparableString(value: unknown): string | null | undefined {
  if (typeof value === 'string') return value
  if (value === null) return null
  return undefined
}

export function toComparableBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function formatComparableValue(value: CheckpointComparableValue | undefined): string {
  if (value === undefined) return 'undefined'
  return JSON.stringify(value)
}

/**
 * Normalize checkpoint stage name to valid StepName.
 */
export function normalizeCheckpointStageName(stageName: unknown): StepName | null {
  if (typeof stageName !== 'string') return null
  const normalized = stageName.trim().toLowerCase()
  if (STAGES.includes(normalized as StepName)) {
    return normalized as StepName
  }

  if (normalized === 'translate' || normalized === 'translation') {
    return 'translating'
  }
  if (normalized === 'tts' || normalized === 'synthesize' || normalized === 'synthesis') {
    return 'synthesizing'
  }
  return null
}

/**
 * Check if stage is a segment processing stage.
 */
export function isSegmentStage(stageName: StepName): stageName is SegmentStageName {
  return stageName === 'translating' || stageName === 'synthesizing'
}

/**
 * Parse failed segment IDs from checkpoint data.
 */
export function parseFailedSegmentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === 'string').map((id) => id.trim()).filter(Boolean)
}

export type ArtifactTypeForResume = 'video' | 'audio' | 'transcript' | 'translation' | 'tts'

/**
 * Determine which artifact type is required for a stage.
 */
export function stageRequiresArtifact(
  stageName: StepName,
): ArtifactTypeForResume | null {
  if (stageName === 'extracting') return 'video'
  if (stageName === 'transcribing') return 'audio'
  if (stageName === 'translating') return 'transcript'
  if (stageName === 'synthesizing') return 'translation'
  if (stageName === 'merging') return 'tts'
  return null
}

/**
 * Check if task can resume at specified stage with available artifacts.
 */
export function canResumeAtStage(
  stageName: StepName,
  artifactTypes: Set<ArtifactTypeForResume>,
): boolean {
  const required = stageRequiresArtifact(stageName)
  if (!required) return true
  return artifactTypes.has(required)
}

/**
 * Safely convert value to number within bounds.
 */
export function toSafeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

/**
 * Parse duration from ffmpeg output line.
 */
export function parseDurationFromLine(line: string): number | null {
  const matched = line.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i)
  if (!matched) return null
  const hours = Number(matched[1])
  const minutes = Number(matched[2])
  const seconds = Number(matched[3])
  if ([hours, minutes, seconds].some((value) => Number.isNaN(value))) return null
  return hours * 3600 + minutes * 60 + seconds
}
