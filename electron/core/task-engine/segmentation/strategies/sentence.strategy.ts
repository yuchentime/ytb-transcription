import type { SegmentationOptions } from '../../../db/types'

function splitBySentence(text: string): string[] {
  const parts = text.match(/[^。！？!?\n]+[。！？!?\n]*/g)
  return parts ? parts : [text]
}

function chunkByTarget(parts: string[], targetChars: number): string[] {
  const chunks: string[] = []
  let current = ''

  for (const part of parts) {
    const normalized = part.trim()
    if (!normalized) continue

    if (!current) {
      current = normalized
      continue
    }

    if ((current + ' ' + normalized).length <= targetChars) {
      current = `${current} ${normalized}`
      continue
    }

    chunks.push(current)
    current = normalized
  }

  if (current) chunks.push(current)
  return chunks
}

export function sentenceSegment(text: string, options?: SegmentationOptions): string[] {
  const targetChars = Math.max(60, options?.targetSegmentLength ?? options?.maxCharsPerSegment ?? 260)
  return chunkByTarget(splitBySentence(text), targetChars)
}
