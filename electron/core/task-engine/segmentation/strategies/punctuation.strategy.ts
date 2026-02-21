import type { SegmentationOptions } from '../../../db/types'

function splitByPunctuation(text: string): string[] {
  const parts = text.match(/[^。！？!?；;，,、\n]+[。！？!?；;，,、\n]*/g)
  return parts ? parts : [text]
}

function chunkByMaxChars(parts: string[], maxChars: number): string[] {
  const chunks: string[] = []
  let buffer = ''

  for (const part of parts) {
    if (!part.trim()) continue
    if (!buffer) {
      buffer = part
      continue
    }

    if ((buffer + part).length <= maxChars) {
      buffer += part
      continue
    }

    chunks.push(buffer)
    buffer = part
  }

  if (buffer.trim()) {
    chunks.push(buffer)
  }

  return chunks
}

export function punctuationSegment(text: string, options?: SegmentationOptions): string[] {
  const maxChars = Math.max(40, options?.maxCharsPerSegment ?? options?.targetSegmentLength ?? 220)
  const parts = splitByPunctuation(text)
  return chunkByMaxChars(parts, maxChars)
}
