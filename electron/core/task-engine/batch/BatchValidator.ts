export interface BatchRejectedItem {
  url: string
  reason: string
}

export interface BatchValidationResult {
  totalCount: number
  accepted: string[]
  rejected: BatchRejectedItem[]
}

export class BatchValidator {
  constructor(private readonly maxBatchSize: number) {}

  validate(urls: string[]): BatchValidationResult {
    if (!Array.isArray(urls)) {
      throw new Error('urls must be an array')
    }

    if (urls.length === 0) {
      throw new Error('urls cannot be empty')
    }

    if (urls.length > this.maxBatchSize) {
      throw new Error(`batch size exceeds limit (${this.maxBatchSize})`)
    }

    const accepted: string[] = []
    const rejected: BatchRejectedItem[] = []
    const seen = new Set<string>()

    for (const raw of urls) {
      if (typeof raw !== 'string') {
        rejected.push({
          url: String(raw),
          reason: 'URL must be a string',
        })
        continue
      }

      const candidate = raw.trim()
      if (!candidate) {
        rejected.push({
          url: raw,
          reason: 'URL cannot be empty',
        })
        continue
      }

      const normalized = this.normalizeYoutubeUrl(candidate)
      if (!normalized) {
        rejected.push({
          url: candidate,
          reason: 'Invalid YouTube URL',
        })
        continue
      }

      if (seen.has(normalized)) {
        rejected.push({
          url: candidate,
          reason: 'Duplicate URL',
        })
        continue
      }

      seen.add(normalized)
      accepted.push(normalized)
    }

    return {
      totalCount: urls.length,
      accepted,
      rejected,
    }
  }

  private normalizeYoutubeUrl(value: string): string | null {
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null
      }

      const hostname = parsed.hostname.toLowerCase()
      const isYoutubeHost =
        hostname === 'youtube.com' ||
        hostname === 'www.youtube.com' ||
        hostname === 'm.youtube.com' ||
        hostname === 'youtu.be' ||
        hostname === 'www.youtu.be'

      if (!isYoutubeHost) {
        return null
      }

      return parsed.toString()
    } catch {
      return null
    }
  }
}
