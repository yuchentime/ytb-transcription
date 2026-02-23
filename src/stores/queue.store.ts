import type { QueueSnapshot } from '../../electron/core/db/types'
import type { BatchProgressEventPayload, QueueUpdatedEventPayload } from '../../electron/ipc/channels'

export interface QueueState {
  snapshot: QueueSnapshot
  loading: boolean
  error: string
  updatedSummary: QueueUpdatedEventPayload | null
  batchProgressMap: Record<string, BatchProgressEventPayload>
}

export function createInitialQueueState(): QueueState {
  return {
    snapshot: {
      waiting: [],
      running: [],
      completed: [],
      failed: [],
      paused: false,
      updatedAt: '',
    },
    loading: false,
    error: '',
    updatedSummary: null,
    batchProgressMap: {},
  }
}
