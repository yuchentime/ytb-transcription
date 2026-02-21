import type { SegmentStageName, TaskSegmentRecord } from '../../db/types'
import { TaskRecoveryDao } from '../../db/dao/TaskRecoveryDao'
import { TaskSegmentDao } from '../../db/dao/TaskSegmentDao'

interface SaveCheckpointInput {
  taskId: string
  stageName: SegmentStageName
  checkpointSegmentId: string
  configSnapshot: Record<string, unknown>
}

function summarizeSegments(segments: TaskSegmentRecord[]): {
  successfulSegmentIds: string[]
  failedSegmentIds: string[]
} {
  const successfulSegmentIds = segments.filter((item) => item.status === 'success').map((item) => item.id)
  const failedSegmentIds = segments.filter((item) => item.status === 'failed').map((item) => item.id)
  return { successfulSegmentIds, failedSegmentIds }
}

export class CheckpointStore {
  constructor(
    private readonly taskRecoveryDao: TaskRecoveryDao,
    private readonly taskSegmentDao: TaskSegmentDao,
  ) {}

  saveSegmentCheckpoint(input: SaveCheckpointInput): void {
    const segments = this.taskSegmentDao.listByTaskAndStage(input.taskId, input.stageName)
    const summary = summarizeSegments(segments)
    const snapshot = {
      stageName: input.stageName,
      checkpointSegmentId: input.checkpointSegmentId,
      ...summary,
      configSnapshot: input.configSnapshot,
      createdAt: new Date().toISOString(),
    }

    this.taskRecoveryDao.saveSnapshot(
      input.taskId,
      input.stageName,
      `${input.stageName}:${input.checkpointSegmentId}`,
      snapshot,
    )
  }
}
