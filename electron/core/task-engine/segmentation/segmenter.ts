import { randomUUID } from 'node:crypto'
import type { SegmentationOptions, SegmentationStrategy } from '../../db/types'
import { durationSegment } from './strategies/duration.strategy'
import { punctuationSegment } from './strategies/punctuation.strategy'
import { sentenceSegment } from './strategies/sentence.strategy'

export interface TextSegment {
  id: string
  index: number
  text: string
  estimatedDurationSec: number
}

interface SegmenterOptions {
  strategy: SegmentationStrategy
  options?: SegmentationOptions
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

function estimateDurationSec(text: string): number {
  // Rough estimate for speech pace. Keeps strategy independent from TTS provider.
  const charsPerSecond = 4
  return Math.max(1, Math.ceil(text.length / charsPerSecond))
}

function segmentWithConfig(text: string, config: SegmenterOptions): TextSegment[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim()
  if (!cleaned) return []

  let chunks: string[] = []
  if (config.strategy === 'sentence') {
    chunks = sentenceSegment(cleaned, config.options)
  } else if (config.strategy === 'duration') {
    chunks = durationSegment(cleaned, config.options)
  } else {
    chunks = punctuationSegment(cleaned, config.options)
  }

  const normalizedChunks = chunks.map((chunk) => chunk.trim()).filter(Boolean)
  return normalizedChunks.map((chunk, index) => ({
    id: randomUUID(),
    index,
    text: chunk,
    estimatedDurationSec: estimateDurationSec(chunk),
  }))
}

export function segment(
  text: string,
  strategy: SegmentationStrategy,
  options?: SegmentationOptions,
): TextSegment[] {
  return segmentWithConfig(text, { strategy, options })
}

// Backward-compatible wrapper for callers using the old config-object signature.
export function segmentText(text: string, config: SegmenterOptions): TextSegment[] {
  return segmentWithConfig(text, config)
}

export function assertSegmentIntegrity(originalText: string, segments: TextSegment[]): void {
  const original = normalizeWhitespace(originalText)
  const merged = normalizeWhitespace(segments.map((segment) => segment.text).join(' '))
  if (original !== merged) {
    throw new Error('Segment integrity check failed: merged text differs from source text')
  }
}
