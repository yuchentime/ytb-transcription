import type Database from 'better-sqlite3'
import type { QueueSnapshot, QueueStatus, QueueTaskRecord } from '../types'

interface QueueTaskRow {
  taskId: string
  youtubeUrl: string | null
  batchId: string | null
  queueStatus: QueueStatus
  priority: number
  queueIndex: number
  enqueuedAt: string
  startedAt: string | null
  heartbeatAt: string | null
  finishedAt: string | null
  workerSlot: number | null
  lastErrorCode: string | null
}

function mapQueueTask(row: QueueTaskRow): QueueTaskRecord {
  return {
    taskId: row.taskId,
    youtubeUrl: row.youtubeUrl ?? '',
    batchId: row.batchId,
    queueStatus: row.queueStatus,
    priority: row.priority,
    queueIndex: row.queueIndex,
    enqueuedAt: row.enqueuedAt,
    startedAt: row.startedAt,
    heartbeatAt: row.heartbeatAt,
    finishedAt: row.finishedAt,
    workerSlot: row.workerSlot,
    lastErrorCode: row.lastErrorCode,
  }
}

export class TaskQueueDao {
  constructor(private readonly db: Database.Database) {}

  enqueue(taskId: string, batchId?: string | null, priority = 0): QueueTaskRecord {
    const safePriority = Number.isFinite(priority) ? Math.floor(priority) : 0
    const run = this.db.transaction(() => {
      const existed = this.db
        .prepare('SELECT task_id AS taskId FROM task_queue WHERE task_id = ?')
        .get(taskId) as { taskId: string } | undefined

      if (existed) {
        throw new Error(`Task already in queue: ${taskId}`)
      }

      const maxIndexRow = this.db
        .prepare(
          `
          SELECT COALESCE(MAX(queue_index), -1) AS maxIndex
          FROM task_queue
          WHERE queue_status = 'waiting'
        `,
        )
        .get() as { maxIndex: number }

      const now = new Date().toISOString()
      this.db
        .prepare(
          `
          INSERT INTO task_queue(
            task_id, batch_id, queue_status, priority, queue_index,
            enqueued_at, started_at, heartbeat_at, finished_at, worker_slot, last_error_code
          ) VALUES (?, ?, 'waiting', ?, ?, ?, NULL, NULL, NULL, NULL, NULL)
        `,
        )
        .run(taskId, batchId ?? null, safePriority, maxIndexRow.maxIndex + 1, now)
    })

    run()
    return this.getByTaskId(taskId)
  }

  dequeueNext(limit: number): QueueTaskRecord[] {
    const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)))
    const rows = this.db
      .prepare(
        `
        SELECT
          q.task_id AS taskId,
          t.youtube_url AS youtubeUrl,
          q.batch_id AS batchId,
          q.queue_status AS queueStatus,
          q.priority,
          q.queue_index AS queueIndex,
          q.enqueued_at AS enqueuedAt,
          q.started_at AS startedAt,
          q.heartbeat_at AS heartbeatAt,
          q.finished_at AS finishedAt,
          q.worker_slot AS workerSlot,
          q.last_error_code AS lastErrorCode
        FROM task_queue q
        LEFT JOIN tasks t ON t.id = q.task_id
        WHERE q.queue_status = 'waiting'
        ORDER BY q.priority DESC, q.queue_index ASC
        LIMIT ?
      `,
      )
      .all(safeLimit) as QueueTaskRow[]

    return rows.map(mapQueueTask)
  }

  updateQueueStatus(
    taskId: string,
    status: QueueStatus,
    patch?: {
      queueIndex?: number
      workerSlot?: number | null
      lastErrorCode?: string | null
      heartbeatAt?: string | null
      startedAt?: string | null
      finishedAt?: string | null
    },
  ): QueueTaskRecord {
    const current = this.getByTaskId(taskId)
    const now = new Date().toISOString()

    const startedAt =
      patch?.startedAt !== undefined
        ? patch.startedAt
        : status === 'running'
          ? current.startedAt ?? now
          : status === 'waiting'
            ? null
            : current.startedAt

    const heartbeatAt =
      patch?.heartbeatAt !== undefined
        ? patch.heartbeatAt
        : status === 'running'
          ? now
          : null

    const finishedAt =
      patch?.finishedAt !== undefined
        ? patch.finishedAt
        : status === 'completed' || status === 'failed' || status === 'removed'
          ? now
          : null

    const queueIndex =
      patch?.queueIndex !== undefined
        ? Math.max(0, Math.floor(patch.queueIndex))
        : current.queueIndex

    const workerSlot =
      patch?.workerSlot !== undefined
        ? patch.workerSlot
        : status === 'running'
          ? current.workerSlot
          : null

    this.db
      .prepare(
        `
        UPDATE task_queue
        SET
          queue_status = ?,
          queue_index = ?,
          started_at = ?,
          heartbeat_at = ?,
          finished_at = ?,
          worker_slot = ?,
          last_error_code = ?,
          enqueued_at = CASE
            WHEN ? = 'waiting' THEN COALESCE(enqueued_at, ?)
            ELSE enqueued_at
          END
        WHERE task_id = ?
      `,
      )
      .run(
        status,
        queueIndex,
        startedAt,
        heartbeatAt,
        finishedAt,
        workerSlot ?? null,
        patch?.lastErrorCode ?? current.lastErrorCode,
        status,
        now,
        taskId,
      )

    return this.getByTaskId(taskId)
  }

  reorder(taskId: string, toIndex: number): { fromIndex: number; toIndex: number } {
    const run = this.db.transaction(() => {
      const waitingRows = this.db
        .prepare(
          `
          SELECT
            task_id AS taskId,
            queue_index AS queueIndex
          FROM task_queue
          WHERE queue_status = 'waiting'
          ORDER BY queue_index ASC
        `,
        )
        .all() as Array<{ taskId: string; queueIndex: number }>

      const fromIndex = waitingRows.findIndex((item) => item.taskId === taskId)
      if (fromIndex < 0) {
        throw new Error(`Task ${taskId} is not in waiting queue`)
      }

      const clampedToIndex = Math.max(0, Math.min(waitingRows.length - 1, Math.floor(toIndex)))
      if (clampedToIndex === fromIndex) {
        return { fromIndex, toIndex: clampedToIndex }
      }

      const [target] = waitingRows.splice(fromIndex, 1)
      waitingRows.splice(clampedToIndex, 0, target)

      const updateIndex = this.db.prepare(
        'UPDATE task_queue SET queue_index = ? WHERE task_id = ? AND queue_status = \'waiting\'',
      )

      waitingRows.forEach((item, index) => {
        updateIndex.run(index, item.taskId)
      })

      return { fromIndex, toIndex: clampedToIndex }
    })

    return run()
  }

  removeWaitingTask(taskId: string): boolean {
    const run = this.db.transaction(() => {
      const waitingRows = this.db
        .prepare(
          `
          SELECT
            task_id AS taskId,
            queue_index AS queueIndex
          FROM task_queue
          WHERE queue_status = 'waiting'
          ORDER BY queue_index ASC
        `,
        )
        .all() as Array<{ taskId: string; queueIndex: number }>

      const targetIndex = waitingRows.findIndex((item) => item.taskId === taskId)
      if (targetIndex < 0) {
        return false
      }

      const now = new Date().toISOString()
      this.db
        .prepare(
          `
          UPDATE task_queue
          SET queue_status = 'removed', finished_at = ?, started_at = NULL, heartbeat_at = NULL, worker_slot = NULL
          WHERE task_id = ?
        `,
        )
        .run(now, taskId)

      waitingRows.splice(targetIndex, 1)
      const updateIndex = this.db.prepare(
        'UPDATE task_queue SET queue_index = ? WHERE task_id = ? AND queue_status = \'waiting\'',
      )
      waitingRows.forEach((item, index) => {
        updateIndex.run(index, item.taskId)
      })

      return true
    })

    return run()
  }

  getSnapshot(): QueueSnapshot {
    const rows = this.db
      .prepare(
        `
        SELECT
          q.task_id AS taskId,
          t.youtube_url AS youtubeUrl,
          q.batch_id AS batchId,
          q.queue_status AS queueStatus,
          q.priority,
          q.queue_index AS queueIndex,
          q.enqueued_at AS enqueuedAt,
          q.started_at AS startedAt,
          q.heartbeat_at AS heartbeatAt,
          q.finished_at AS finishedAt,
          q.worker_slot AS workerSlot,
          q.last_error_code AS lastErrorCode
        FROM task_queue q
        LEFT JOIN tasks t ON t.id = q.task_id
        WHERE q.queue_status IN ('waiting', 'running', 'completed', 'failed')
        ORDER BY
          CASE q.queue_status
            WHEN 'waiting' THEN 0
            WHEN 'running' THEN 1
            WHEN 'completed' THEN 2
            WHEN 'failed' THEN 3
            ELSE 4
          END,
          q.queue_index ASC,
          q.enqueued_at ASC
      `,
      )
      .all() as QueueTaskRow[]

    const waiting: QueueTaskRecord[] = []
    const running: QueueTaskRecord[] = []
    const completed: QueueTaskRecord[] = []
    const failed: QueueTaskRecord[] = []

    for (const row of rows) {
      const record = mapQueueTask(row)
      if (record.queueStatus === 'waiting') {
        waiting.push(record)
      } else if (record.queueStatus === 'running') {
        running.push(record)
      } else if (record.queueStatus === 'completed') {
        completed.push(record)
      } else if (record.queueStatus === 'failed') {
        failed.push(record)
      }
    }

    return {
      waiting,
      running,
      completed,
      failed,
      paused: false,
      updatedAt: new Date().toISOString(),
    }
  }

  listStaleRunningTasks(timeoutMs: number): QueueTaskRecord[] {
    const safeTimeoutMs = Math.max(1000, Math.floor(timeoutMs))
    const threshold = new Date(Date.now() - safeTimeoutMs).toISOString()

    const rows = this.db
      .prepare(
        `
        SELECT
          q.task_id AS taskId,
          t.youtube_url AS youtubeUrl,
          q.batch_id AS batchId,
          q.queue_status AS queueStatus,
          q.priority,
          q.queue_index AS queueIndex,
          q.enqueued_at AS enqueuedAt,
          q.started_at AS startedAt,
          q.heartbeat_at AS heartbeatAt,
          q.finished_at AS finishedAt,
          q.worker_slot AS workerSlot,
          q.last_error_code AS lastErrorCode
        FROM task_queue q
        LEFT JOIN tasks t ON t.id = q.task_id
        WHERE q.queue_status = 'running'
          AND COALESCE(q.heartbeat_at, q.started_at, q.enqueued_at) < ?
        ORDER BY q.queue_index ASC
      `,
      )
      .all(threshold) as QueueTaskRow[]

    return rows.map(mapQueueTask)
  }

  requeueTasks(taskIds: string[]): number {
    if (taskIds.length === 0) return 0

    const run = this.db.transaction(() => {
      const maxIndexRow = this.db
        .prepare(
          `
          SELECT COALESCE(MAX(queue_index), -1) AS maxIndex
          FROM task_queue
          WHERE queue_status = 'waiting'
        `,
        )
        .get() as { maxIndex: number }

      let nextIndex = maxIndexRow.maxIndex + 1
      const updateStmt = this.db.prepare(
        `
        UPDATE task_queue
        SET
          queue_status = 'waiting',
          queue_index = ?,
          started_at = NULL,
          heartbeat_at = NULL,
          finished_at = NULL,
          worker_slot = NULL
        WHERE task_id = ? AND queue_status = 'running'
      `,
      )

      let changed = 0
      for (const taskId of taskIds) {
        const info = updateStmt.run(nextIndex, taskId)
        if (info.changes > 0) {
          changed += info.changes
          nextIndex += 1
        }
      }

      return changed
    })

    return run()
  }

  moveToWaitingTail(taskId: string): QueueTaskRecord {
    const run = this.db.transaction(() => {
      const existed = this.db
        .prepare('SELECT task_id AS taskId FROM task_queue WHERE task_id = ?')
        .get(taskId) as { taskId: string } | undefined

      if (!existed) {
        throw new Error(`Queue task not found: ${taskId}`)
      }

      const maxIndexRow = this.db
        .prepare(
          `
          SELECT COALESCE(MAX(queue_index), -1) AS maxIndex
          FROM task_queue
          WHERE queue_status = 'waiting'
        `,
        )
        .get() as { maxIndex: number }

      const nextIndex = maxIndexRow.maxIndex + 1
      const now = new Date().toISOString()
      this.db
        .prepare(
          `
          UPDATE task_queue
          SET
            queue_status = 'waiting',
            queue_index = ?,
            enqueued_at = ?,
            started_at = NULL,
            heartbeat_at = NULL,
            finished_at = NULL,
            worker_slot = NULL,
            last_error_code = NULL
          WHERE task_id = ?
        `,
        )
        .run(nextIndex, now, taskId)
    })

    run()
    return this.getByTaskId(taskId)
  }

  getByTaskId(taskId: string): QueueTaskRecord {
    const row = this.db
      .prepare(
        `
        SELECT
          q.task_id AS taskId,
          t.youtube_url AS youtubeUrl,
          q.batch_id AS batchId,
          q.queue_status AS queueStatus,
          q.priority,
          q.queue_index AS queueIndex,
          q.enqueued_at AS enqueuedAt,
          q.started_at AS startedAt,
          q.heartbeat_at AS heartbeatAt,
          q.finished_at AS finishedAt,
          q.worker_slot AS workerSlot,
          q.last_error_code AS lastErrorCode
        FROM task_queue q
        LEFT JOIN tasks t ON t.id = q.task_id
        WHERE q.task_id = ?
      `,
      )
      .get(taskId) as QueueTaskRow | undefined

    if (!row) {
      throw new Error(`Queue task not found: ${taskId}`)
    }

    return mapQueueTask(row)
  }
}
