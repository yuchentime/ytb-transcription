import type Database from 'better-sqlite3'
import type { TaskRecoverySnapshotRecord } from '../types'

interface TaskRecoverySnapshotRow {
  id: number
  taskId: string
  stageName: string
  checkpointKey: string
  snapshotJson: string
  createdAt: string
}

function mapSnapshot(row: TaskRecoverySnapshotRow): TaskRecoverySnapshotRecord {
  let snapshotJson: Record<string, unknown> = {}
  try {
    snapshotJson = JSON.parse(row.snapshotJson) as Record<string, unknown>
  } catch {
    snapshotJson = {}
  }

  return {
    id: row.id,
    taskId: row.taskId,
    stageName: row.stageName,
    checkpointKey: row.checkpointKey,
    snapshotJson,
    createdAt: row.createdAt,
  }
}

export class TaskRecoveryDao {
  constructor(private readonly db: Database.Database) {}

  saveSnapshot(
    taskId: string,
    stageName: string,
    checkpointKey: string,
    snapshot: Record<string, unknown>,
  ): TaskRecoverySnapshotRecord {
    const now = new Date().toISOString()
    const info = this.db
      .prepare(
        `
        INSERT INTO task_recovery_snapshots(task_id, stage_name, checkpoint_key, snapshot_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(taskId, stageName, checkpointKey, JSON.stringify(snapshot), now)

    return this.getById(Number(info.lastInsertRowid))
  }

  getLatestSnapshot(taskId: string): TaskRecoverySnapshotRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          task_id AS taskId,
          stage_name AS stageName,
          checkpoint_key AS checkpointKey,
          snapshot_json AS snapshotJson,
          created_at AS createdAt
        FROM task_recovery_snapshots
        WHERE task_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
      )
      .get(taskId) as TaskRecoverySnapshotRow | undefined

    return row ? mapSnapshot(row) : null
  }

  listSnapshots(taskId: string, limit = 20): TaskRecoverySnapshotRecord[] {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)))
    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          task_id AS taskId,
          stage_name AS stageName,
          checkpoint_key AS checkpointKey,
          snapshot_json AS snapshotJson,
          created_at AS createdAt
        FROM task_recovery_snapshots
        WHERE task_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      )
      .all(taskId, safeLimit) as TaskRecoverySnapshotRow[]

    return rows.map(mapSnapshot)
  }

  private getById(id: number): TaskRecoverySnapshotRecord {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          task_id AS taskId,
          stage_name AS stageName,
          checkpoint_key AS checkpointKey,
          snapshot_json AS snapshotJson,
          created_at AS createdAt
        FROM task_recovery_snapshots
        WHERE id = ?
      `,
      )
      .get(id) as TaskRecoverySnapshotRow | undefined

    if (!row) {
      throw new Error(`Recovery snapshot not found: ${id}`)
    }

    return mapSnapshot(row)
  }
}
