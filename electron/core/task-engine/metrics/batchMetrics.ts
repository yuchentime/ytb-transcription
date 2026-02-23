import type { BatchProgress } from '../../db/types'

export interface BatchCompletionMetrics {
  total: number
  queued: number
  running: number
  completed: number
  failed: number
  percent: number
}

export function buildBatchCompletionMetrics(progress: BatchProgress): BatchCompletionMetrics {
  return {
    total: progress.total,
    queued: progress.queued,
    running: progress.running,
    completed: progress.completed,
    failed: progress.failed,
    percent: progress.percent,
  }
}
