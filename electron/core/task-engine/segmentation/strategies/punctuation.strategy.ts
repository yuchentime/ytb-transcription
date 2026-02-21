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
    const pieces: string[] = []
    if (part.length <= maxChars) {
      pieces.push(part)
    } else {
      let offset = 0
      while (offset < part.length) {
        pieces.push(part.slice(offset, offset + maxChars))
        offset += maxChars
      }
    }

    for (const piece of pieces) {
      if (!buffer) {
        buffer = piece
        continue
      }

      if ((buffer + piece).length <= maxChars) {
        buffer += piece
        continue
      }

      chunks.push(buffer)
      buffer = piece
    }
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
