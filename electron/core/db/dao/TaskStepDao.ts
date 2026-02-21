import type Database from 'better-sqlite3'
import type { StepName, StepStatus, TaskStepRecord } from '../types'

interface TaskStepRow {
  id: number
  taskId: string
  stepName: StepName
  status: StepStatus
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  retryCount: number
  logExcerpt: string | null
  errorCode: string | null
  errorMessage: string | null
}

function mapTaskStep(row: TaskStepRow): TaskStepRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    stepName: row.stepName,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMs: row.durationMs,
    retryCount: row.retryCount,
    logExcerpt: row.logExcerpt,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  }
}

function calculateDurationMs(startedAt: string | null, endedAt: string): number | null {
  if (!startedAt) return null
  const startMs = Date.parse(startedAt)
  const endMs = Date.parse(endedAt)
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null
  return Math.max(0, endMs - startMs)
}

export class TaskStepDao {
  constructor(private readonly db: Database.Database) {}

  startStep(taskId: string, stepName: StepName, retryCount = 0): number {
    const now = new Date().toISOString()
    const info = this.db
      .prepare(
        `
        INSERT INTO task_steps(
          task_id, step_name, status, started_at, ended_at, duration_ms,
          retry_count, log_excerpt, error_code, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(taskId, stepName, 'running', now, null, null, retryCount, null, null, null)

    return Number(info.lastInsertRowid)
  }

  finishStep(stepId: number, logExcerpt?: string | null): TaskStepRecord {
    const current = this.getStep(stepId)
    const endedAt = new Date().toISOString()
    const durationMs = calculateDurationMs(current.startedAt, endedAt)

    this.db
      .prepare(
        `
        UPDATE task_steps
        SET status = ?, ended_at = ?, duration_ms = ?, log_excerpt = COALESCE(?, log_excerpt)
        WHERE id = ?
      `,
      )
      .run('success', endedAt, durationMs, logExcerpt ?? null, stepId)

    return this.getStep(stepId)
  }

  failStep(
    stepId: number,
    errorCode: string,
    errorMessage: string,
    logExcerpt?: string | null,
  ): TaskStepRecord {
    const current = this.getStep(stepId)
    const endedAt = new Date().toISOString()
    const durationMs = calculateDurationMs(current.startedAt, endedAt)

    this.db
      .prepare(
        `
        UPDATE task_steps
        SET
          status = ?,
          ended_at = ?,
          duration_ms = ?,
          error_code = ?,
          error_message = ?,
          log_excerpt = COALESCE(?, log_excerpt)
        WHERE id = ?
      `,
      )
      .run('failed', endedAt, durationMs, errorCode, errorMessage, logExcerpt ?? null, stepId)

    return this.getStep(stepId)
  }

  skipStep(stepId: number, logExcerpt?: string | null): TaskStepRecord {
    const current = this.getStep(stepId)
    const endedAt = new Date().toISOString()
    const durationMs = calculateDurationMs(current.startedAt, endedAt)

    this.db
      .prepare(
        `
        UPDATE task_steps
        SET status = ?, ended_at = ?, duration_ms = ?, log_excerpt = COALESCE(?, log_excerpt)
        WHERE id = ?
      `,
      )
      .run('skipped', endedAt, durationMs, logExcerpt ?? null, stepId)

    return this.getStep(stepId)
  }

  listSteps(taskId: string): TaskStepRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          task_id AS taskId,
          step_name AS stepName,
          status,
          started_at AS startedAt,
          ended_at AS endedAt,
          duration_ms AS durationMs,
          retry_count AS retryCount,
          log_excerpt AS logExcerpt,
          error_code AS errorCode,
          error_message AS errorMessage
        FROM task_steps
        WHERE task_id = ?
        ORDER BY id ASC
      `,
      )
      .all(taskId) as TaskStepRow[]

    return rows.map(mapTaskStep)
  }

  getStep(stepId: number): TaskStepRecord {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          task_id AS taskId,
          step_name AS stepName,
          status,
          started_at AS startedAt,
          ended_at AS endedAt,
          duration_ms AS durationMs,
          retry_count AS retryCount,
          log_excerpt AS logExcerpt,
          error_code AS errorCode,
          error_message AS errorMessage
        FROM task_steps
        WHERE id = ?
      `,
      )
      .get(stepId) as TaskStepRow | undefined

    if (!row) {
      throw new Error(`Task step not found: ${stepId}`)
    }

    return mapTaskStep(row)
  }
}

