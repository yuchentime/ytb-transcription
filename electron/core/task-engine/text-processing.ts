import { randomUUID } from 'node:crypto'
import type { TextSegment } from './segmentation'
import { DEFAULT_TRANSLATE_MIN_CHUNK_CHARS } from './constants'

/**
 * Trim context window from text.
 */
export function trimContextWindow(text: string, limit: number, fromEnd: boolean): string {
  const normalized = text.trim()
  if (!normalized || limit <= 0) return ''
  if (normalized.length <= limit) return normalized
  return fromEnd ? normalized.slice(-limit) : normalized.slice(0, limit)
}

/**
 * Estimate token count for text (rough approximation).
 * CJK characters: 1 token per char
 * Other characters: 1 token per 4 chars
 */
export function estimateTokenCount(text: string): number {
  const normalized = text.trim()
  if (!normalized) return 0
  const cjkMatches = normalized.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu)
  const cjkChars = cjkMatches?.length ?? 0
  const otherChars = Math.max(0, normalized.length - cjkChars)
  return cjkChars + Math.ceil(otherChars / 4)
}

/**
 * Resolve character budget from token budget.
 */
export function resolveCharBudgetByTokenBudget(text: string, tokenBudget: number): number {
  if (tokenBudget <= 0) return DEFAULT_TRANSLATE_MIN_CHUNK_CHARS
  const estimatedTokens = estimateTokenCount(text)
  if (estimatedTokens <= 0) {
    return Math.max(DEFAULT_TRANSLATE_MIN_CHUNK_CHARS, tokenBudget * 2)
  }
  const charsPerToken = text.length / estimatedTokens
  const safeCharsPerToken = Math.max(1, Math.min(4, charsPerToken * 0.9))
  return Math.max(
    DEFAULT_TRANSLATE_MIN_CHUNK_CHARS,
    Math.floor(tokenBudget * safeCharsPerToken),
  )
}

/**
 * Split text by hard character limit at natural boundaries.
 */
export function splitTextByHardLimit(text: string, maxChars: number): string[] {
  const normalized = text.trim()
  if (!normalized) return []
  if (maxChars <= 0 || normalized.length <= maxChars) return [normalized]

  const chunks: string[] = []
  let cursor = 0
  const boundaryPattern = /[\s,.!?;:，。！？；：、)\]】）}]/u
  while (cursor < normalized.length) {
    const remaining = normalized.length - cursor
    if (remaining <= maxChars) {
      chunks.push(normalized.slice(cursor))
      break
    }

    const hardEnd = Math.min(normalized.length, cursor + maxChars)
    const searchStart = Math.max(cursor + Math.floor(maxChars * 0.6), cursor + 1)
    let splitAt = hardEnd
    for (let pointer = hardEnd; pointer > searchStart; pointer -= 1) {
      if (boundaryPattern.test(normalized[pointer - 1] ?? '')) {
        splitAt = pointer
        break
      }
    }

    if (splitAt <= cursor) {
      splitAt = hardEnd
    }
    chunks.push(normalized.slice(cursor, splitAt))
    cursor = splitAt
  }

  return chunks.map((item) => item.trim()).filter(Boolean)
}

/**
 * Split text by token budget (recursive).
 */
export function splitTextByTokenBudget(
  text: string,
  tokenBudget: number,
  depth = 0,
): string[] {
  const normalized = text.trim()
  if (!normalized) return []
  if (estimateTokenCount(normalized) <= tokenBudget) return [normalized]
  if (depth >= 8) {
    const half = Math.floor(normalized.length / 2)
    if (half <= 0 || half >= normalized.length) return [normalized]
    const left = normalized.slice(0, half).trim()
    const right = normalized.slice(half).trim()
    return [left, right].filter(Boolean)
  }

  const charBudget = resolveCharBudgetByTokenBudget(normalized, tokenBudget)
  let pieces = splitTextByHardLimit(normalized, charBudget)
  if (pieces.length <= 1) {
    const fallbackHalf = Math.floor(normalized.length / 2)
    if (fallbackHalf <= 0 || fallbackHalf >= normalized.length) return [normalized]
    pieces = [
      normalized.slice(0, fallbackHalf).trim(),
      normalized.slice(fallbackHalf).trim(),
    ].filter(Boolean)
  }
  return pieces.flatMap((piece) => splitTextByTokenBudget(piece, tokenBudget, depth + 1))
}

/**
 * Split text by punctuation units (Chinese/English).
 */
export function splitTextByPunctuationUnits(text: string): string[] {
  const normalized = text.trim()
  if (!normalized) return []
  const matched = normalized.match(/[^。！？!?；;，,、\n]+[。！？!?；;，,、\n]*/g)
  if (!matched) return [normalized]
  return matched.map((item) => item.trim()).filter(Boolean)
}

/**
 * Split text by punctuation for TTS with target segment size.
 */
export function splitTextByPunctuationForTts(text: string, targetChars: number): string[] {
  const units = splitTextByPunctuationUnits(text)
  if (units.length === 0) return []
  if (targetChars <= 0) return units

  const chunks: string[] = []
  let buffer = ''
  for (const unit of units) {
    if (!buffer) {
      buffer = unit
      continue
    }
    if ((buffer + unit).length <= targetChars) {
      buffer += unit
      continue
    }
    chunks.push(buffer.trim())
    buffer = unit
  }
  if (buffer.trim()) {
    chunks.push(buffer.trim())
  }
  return chunks
}

/**
 * Build TextSegment array from chunk texts.
 */
export function buildSegmentsFromChunkTexts(chunks: string[]): TextSegment[] {
  return chunks.map((chunk, index) => ({
    id: randomUUID(),
    index,
    text: chunk,
    estimatedDurationSec: Math.max(1, Math.ceil(chunk.length / 4)),
  }))
}

/**
 * Merge chunk transcript with overlap detection.
 */
export function mergeChunkTranscript(previousText: string, currentText: string): string {
  const previous = previousText.trim()
  const current = currentText.trim()
  if (!previous) return current
  if (!current) return previous

  const maxOverlap = Math.min(200, previous.length, current.length)
  for (let overlap = maxOverlap; overlap >= 16; overlap -= 1) {
    const prevTail = previous.slice(-overlap).toLowerCase()
    const currentHead = current.slice(0, overlap).toLowerCase()
    if (prevTail === currentHead) {
      return `${previous}${current.slice(overlap)}`
    }
  }
  return `${previous}\n${current}`
}

/**
 * Join translated chunks with newlines.
 */
export function joinTranslatedChunks(chunks: string[]): string {
  return chunks.map((chunk) => chunk.trim()).filter(Boolean).join('\n')
}

/**
 * Resolve dominant language from candidates.
 */
export function resolveDominantLanguage(candidates: string[]): string | null {
  if (candidates.length === 0) return null
  const counts = new Map<string, number>()
  for (const language of candidates) {
    const normalized = language.trim().toLowerCase()
    if (!normalized) continue
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return best
}
