import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { SegmentStageName, SegmentStatus, TaskSegmentRecord } from '../types'

interface TaskSegmentRow {
  id: string
  taskId: string
  stageName: SegmentStageName
  segmentIndex: number
  sourceText: string | null
  targetText: string | null
  status: SegmentStatus
  retryCount: number
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
}

function mapTaskSegment(row: TaskSegmentRow): TaskSegmentRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    stageName: row.stageName,
    segmentIndex: row.segmentIndex,
    sourceText: row.sourceText,
    targetText: row.targetText,
    status: row.status,
    retryCount: row.retryCount,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMs: row.durationMs,
  }
}

function calculateDurationMs(startedAt: string | null, endedAt: string): number | null {
  if (!startedAt) return null
  const startMs = Date.parse(startedAt)
  const endMs = Date.parse(endedAt)
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null
  return Math.max(0, endMs - startMs)
}

export class TaskSegmentDao {
  constructor(private readonly db: Database.Database) {}

  createSegments(
    taskId: string,
    stageName: SegmentStageName,
    segments: Array<{
      id?: string
      segmentIndex: number
      sourceText?: string | null
      targetText?: string | null
      status?: SegmentStatus
      retryCount?: number
    }>,
  ): TaskSegmentRecord[] {
    const insert = this.db.prepare(`
      INSERT INTO task_segments(
        id, task_id, stage_name, segment_index,
        source_text, target_text, status, retry_count,
        error_code, error_message, started_at, ended_at, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const run = this.db.transaction(() => {
      for (const segment of segments) {
        const now = segment.status === 'running' ? new Date().toISOString() : null
        insert.run(
          segment.id ?? randomUUID(),
          taskId,
          stageName,
          segment.segmentIndex,
          segment.sourceText ?? null,
          segment.targetText ?? null,
          segment.status ?? 'pending',
          segment.retryCount ?? 0,
          null,
          null,
          now,
          null,
          null,
        )
      }
    })

    run()
    return this.listByTaskAndStage(taskId, stageName)
  }

  clearByTaskAndStage(taskId: string, stageName: SegmentStageName): number {
    const info = this.db
      .prepare('DELETE FROM task_segments WHERE task_id = ? AND stage_name = ?')
      .run(taskId, stageName)
    return info.changes
  }

  markSegmentRunning(segmentId: string): TaskSegmentRecord {
    const now = new Date().toISOString()
    this.db
      .prepare(`
        UPDATE task_segments
        SET status = ?, started_at = ?, ended_at = NULL, duration_ms = NULL, error_code = NULL, error_message = NULL
        WHERE id = ?
      `)
      .run('running', now, segmentId)

    return this.getById(segmentId)
  }

  markSegmentSuccess(
    segmentId: string,
    patch?: {
      sourceText?: string | null
      targetText?: string | null
    },
  ): TaskSegmentRecord {
    const current = this.getById(segmentId)
    const endedAt = new Date().toISOString()
    const durationMs = calculateDurationMs(current.startedAt, endedAt)

    this.db
      .prepare(`
        UPDATE task_segments
        SET
          status = ?,
          source_text = COALESCE(?, source_text),
          target_text = COALESCE(?, target_text),
          error_code = NULL,
          error_message = NULL,
          ended_at = ?,
          duration_ms = ?
        WHERE id = ?
      `)
      .run('success', patch?.sourceText ?? null, patch?.targetText ?? null, endedAt, durationMs, segmentId)

    return this.getById(segmentId)
  }

  markSegmentFailed(
    segmentId: string,
    error: {
      errorCode: string
      errorMessage: string
      incrementRetry?: boolean
    },
  ): TaskSegmentRecord {
    const current = this.getById(segmentId)
    const endedAt = new Date().toISOString()
    const durationMs = calculateDurationMs(current.startedAt, endedAt)
    const nextRetryCount = error.incrementRetry ? current.retryCount + 1 : current.retryCount

    this.db
      .prepare(`
        UPDATE task_segments
        SET
          status = ?,
          error_code = ?,
          error_message = ?,
          retry_count = ?,
          ended_at = ?,
          duration_ms = ?
        WHERE id = ?
      `)
      .run('failed', error.errorCode, error.errorMessage, nextRetryCount, endedAt, durationMs, segmentId)

    return this.getById(segmentId)
  }

  listByTask(taskId: string): TaskSegmentRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          id,
          task_id AS taskId,
          stage_name AS stageName,
          segment_index AS segmentIndex,
          source_text AS sourceText,
          target_text AS targetText,
          status,
          retry_count AS retryCount,
          error_code AS errorCode,
          error_message AS errorMessage,
          started_at AS startedAt,
          ended_at AS endedAt,
          duration_ms AS durationMs
        FROM task_segments
        WHERE task_id = ?
        ORDER BY stage_name ASC, segment_index ASC
      `)
      .all(taskId) as TaskSegmentRow[]

    return rows.map(mapTaskSegment)
  }

  listByTaskAndStage(taskId: string, stageName: SegmentStageName): TaskSegmentRecord[] {
    const rows = this.db
      .prepare(`
        SELECT
          id,
          task_id AS taskId,
          stage_name AS stageName,
          segment_index AS segmentIndex,
          source_text AS sourceText,
          target_text AS targetText,
          status,
          retry_count AS retryCount,
          error_code AS errorCode,
          error_message AS errorMessage,
          started_at AS startedAt,
          ended_at AS endedAt,
          duration_ms AS durationMs
        FROM task_segments
        WHERE task_id = ? AND stage_name = ?
        ORDER BY segment_index ASC
      `)
      .all(taskId, stageName) as TaskSegmentRow[]

    return rows.map(mapTaskSegment)
  }

  listFailedSegments(taskId: string, stageName?: SegmentStageName): TaskSegmentRecord[] {
    const rows: TaskSegmentRow[] = stageName
      ? (this.db
          .prepare(`
            SELECT
              id,
              task_id AS taskId,
              stage_name AS stageName,
              segment_index AS segmentIndex,
              source_text AS sourceText,
              target_text AS targetText,
              status,
              retry_count AS retryCount,
              error_code AS errorCode,
              error_message AS errorMessage,
              started_at AS startedAt,
              ended_at AS endedAt,
              duration_ms AS durationMs
            FROM task_segments
            WHERE task_id = ? AND stage_name = ? AND status = 'failed'
            ORDER BY segment_index ASC
          `)
          .all(taskId, stageName) as TaskSegmentRow[])
      : (this.db
          .prepare(`
            SELECT
              id,
              task_id AS taskId,
              stage_name AS stageName,
              segment_index AS segmentIndex,
              source_text AS sourceText,
              target_text AS targetText,
              status,
              retry_count AS retryCount,
              error_code AS errorCode,
              error_message AS errorMessage,
              started_at AS startedAt,
              ended_at AS endedAt,
              duration_ms AS durationMs
            FROM task_segments
            WHERE task_id = ? AND status = 'failed'
            ORDER BY stage_name ASC, segment_index ASC
          `)
          .all(taskId) as TaskSegmentRow[])

    return rows.map(mapTaskSegment)
  }

  getById(segmentId: string): TaskSegmentRecord {
    const row = this.db
      .prepare(`
        SELECT
          id,
          task_id AS taskId,
          stage_name AS stageName,
          segment_index AS segmentIndex,
          source_text AS sourceText,
          target_text AS targetText,
          status,
          retry_count AS retryCount,
          error_code AS errorCode,
          error_message AS errorMessage,
          started_at AS startedAt,
          ended_at AS endedAt,
          duration_ms AS durationMs
        FROM task_segments
        WHERE id = ?
      `)
      .get(segmentId) as TaskSegmentRow | undefined

    if (!row) {
      throw new Error(`Task segment not found: ${segmentId}`)
    }

    return mapTaskSegment(row)
  }
}
