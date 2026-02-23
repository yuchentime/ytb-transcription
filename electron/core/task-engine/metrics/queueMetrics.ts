import type { QueueSnapshot } from '../../db/types'

export interface QueueSnapshotMetrics {
  waiting: number
  running: number
  completed: number
  failed: number
}

export function buildQueueSnapshotMetrics(snapshot: QueueSnapshot): QueueSnapshotMetrics {
  return {
    waiting: snapshot.waiting.length,
    running: snapshot.running.length,
    completed: snapshot.completed.length,
    failed: snapshot.failed.length,
  }
}
