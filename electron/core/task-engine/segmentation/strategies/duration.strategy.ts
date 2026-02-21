import type { SegmentationOptions } from '../../../db/types'
import { punctuationSegment } from './punctuation.strategy'

function splitLongChunk(chunk: string, maxChars: number): string[] {
  if (chunk.length <= maxChars) return [chunk]

  const result: string[] = []
  let offset = 0
  while (offset < chunk.length) {
    result.push(chunk.slice(offset, offset + maxChars))
    offset += maxChars
  }
  return result
}

export function durationSegment(text: string, options?: SegmentationOptions): string[] {
  const targetDurationSec = Math.max(4, options?.targetDurationSec ?? 8)
  const charsPerSecond = 4
  const maxChars = Math.max(30, Math.round(targetDurationSec * charsPerSecond))
  const candidates = punctuationSegment(text, { maxCharsPerSegment: maxChars })

  const chunks: string[] = []
  for (const candidate of candidates) {
    chunks.push(...splitLongChunk(candidate, maxChars))
  }
  return chunks
}
