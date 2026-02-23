import type { QueueSnapshot } from '../../electron/core/db/types'
import type { QueueUpdatedEventPayload } from '../../electron/ipc/channels'

export interface QueueState {
  snapshot: QueueSnapshot
  loading: boolean
  error: string
  updatedSummary: QueueUpdatedEventPayload | null
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
  }
}
