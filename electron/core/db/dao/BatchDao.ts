import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  BatchDetail,
  BatchItemRecord,
  BatchItemStatus,
  BatchProgress,
  BatchRecord,
  BatchStatus,
} from '../types'

interface BatchRow {
  id: string
  name: string | null
  totalCount: number
  acceptedCount: number
  rejectedCount: number
  status: BatchStatus
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

interface BatchItemRow {
  id: number
  batchId: string
  taskId: string | null
  youtubeUrl: string
  status: BatchItemStatus
  rejectReason: string | null
  createdAt: string
  updatedAt: string
}

interface BatchStatusRow {
  totalAccepted: number
  queuedCount: number
  runningCount: number
  completedCount: number
  failedCount: number
}

function mapBatch(row: BatchRow): BatchRecord {
  return {
    id: row.id,
    name: row.name,
    totalCount: row.totalCount,
    acceptedCount: row.acceptedCount,
    rejectedCount: row.rejectedCount,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  }
}

function mapBatchItem(row: BatchItemRow): BatchItemRecord {
  return {
    id: row.id,
    batchId: row.batchId,
    taskId: row.taskId,
    youtubeUrl: row.youtubeUrl,
    status: row.status,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toBatchProgress(batchId: string, row: BatchStatusRow): BatchProgress {
  const total = row.totalAccepted
  const done = row.completedCount + row.failedCount
  return {
    batchId,
    total,
    queued: row.queuedCount,
    running: row.runningCount,
    completed: row.completedCount,
    failed: row.failedCount,
    percent: total <= 0 ? 100 : Math.round((done / total) * 100),
  }
}

export class BatchDao {
  constructor(private readonly db: Database.Database) {}

  createBatch(input: {
    name?: string | null
    totalCount: number
    acceptedCount: number
    rejectedCount: number
    status?: BatchStatus
  }): BatchRecord {
    const id = randomUUID()
    const now = new Date().toISOString()
    const status = input.status ?? 'created'

    this.db
      .prepare(
        `
        INSERT INTO batches(
          id, name, total_count, accepted_count, rejected_count, status,
          created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        input.name?.trim() ?? null,
        input.totalCount,
        input.acceptedCount,
        input.rejectedCount,
        status,
        now,
        now,
        null,
      )

    return this.getBatchRecordById(id)
  }

  addBatchItems(
    batchId: string,
    items: Array<{
      taskId?: string | null
      youtubeUrl: string
      status: BatchItemStatus
      rejectReason?: string | null
    }>,
  ): BatchItemRecord[] {
    if (items.length === 0) return []
    const now = new Date().toISOString()
    const insert = this.db.prepare(
      `
      INSERT INTO batch_items(
        batch_id, task_id, youtube_url, status, reject_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    )

    const run = this.db.transaction(() => {
      for (const item of items) {
        insert.run(
          batchId,
          item.taskId ?? null,
          item.youtubeUrl,
          item.status,
          item.rejectReason ?? null,
          now,
          now,
        )
      }
    })

    run()
    this.syncBatchStatus(batchId)
    return this.listBatchItems(batchId)
  }

  updateBatchProgress(
    batchId: string,
    patch: {
      acceptedCount?: number
      rejectedCount?: number
      status?: BatchStatus
      completedAt?: string | null
    },
  ): BatchRecord {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `
        UPDATE batches
        SET
          accepted_count = COALESCE(?, accepted_count),
          rejected_count = COALESCE(?, rejected_count),
          status = COALESCE(?, status),
          completed_at = CASE
            WHEN ? = 1 THEN COALESCE(?, completed_at)
            ELSE completed_at
          END,
          updated_at = ?
        WHERE id = ?
      `,
      )
      .run(
        patch.acceptedCount ?? null,
        patch.rejectedCount ?? null,
        patch.status ?? null,
        patch.completedAt !== undefined ? 1 : 0,
        patch.completedAt ?? null,
        now,
        batchId,
      )

    return this.getBatchRecordById(batchId)
  }

  updateBatchItemStatusByTaskId(
    taskId: string,
    status: BatchItemStatus,
    patch?: {
      rejectReason?: string | null
    },
  ): BatchItemRecord {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `
        UPDATE batch_items
        SET
          status = ?,
          reject_reason = COALESCE(?, reject_reason),
          updated_at = ?
        WHERE task_id = ?
      `,
      )
      .run(status, patch?.rejectReason ?? null, now, taskId)

    const row = this.db
      .prepare(
        `
        SELECT
          id,
          batch_id AS batchId,
          task_id AS taskId,
          youtube_url AS youtubeUrl,
          status,
          reject_reason AS rejectReason,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM batch_items
        WHERE task_id = ?
        LIMIT 1
      `,
      )
      .get(taskId) as BatchItemRow | undefined

    if (!row) {
      throw new Error(`Batch item not found by taskId: ${taskId}`)
    }

    this.syncBatchStatus(row.batchId)
    return mapBatchItem(row)
  }

  getBatch(batchId: string): BatchDetail {
    return {
      batch: this.getBatchRecordById(batchId),
      items: this.listBatchItems(batchId),
      progress: this.getBatchProgress(batchId),
    }
  }

  listBatches(query?: { page?: number; pageSize?: number }): {
    items: BatchRecord[]
    total: number
    page: number
    pageSize: number
  } {
    const safePage = Number.isFinite(query?.page) ? Math.max(1, Math.floor(query?.page ?? 1)) : 1
    const safePageSize = Number.isFinite(query?.pageSize)
      ? Math.min(100, Math.max(1, Math.floor(query?.pageSize ?? 20)))
      : 20
    const offset = (safePage - 1) * safePageSize

    const totalRow = this.db.prepare('SELECT COUNT(1) AS total FROM batches').get() as { total: number }
    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          name,
          total_count AS totalCount,
          accepted_count AS acceptedCount,
          rejected_count AS rejectedCount,
          status,
          created_at AS createdAt,
          updated_at AS updatedAt,
          completed_at AS completedAt
        FROM batches
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `,
      )
      .all(safePageSize, offset) as BatchRow[]

    return {
      items: rows.map(mapBatch),
      total: totalRow.total,
      page: safePage,
      pageSize: safePageSize,
    }
  }

  getBatchProgress(batchId: string): BatchProgress {
    const row = this.db
      .prepare(
        `
        SELECT
          COUNT(CASE WHEN status <> 'rejected' THEN 1 END) AS totalAccepted,
          COUNT(CASE WHEN status IN ('accepted', 'queued') THEN 1 END) AS queuedCount,
          COUNT(CASE WHEN status = 'running' THEN 1 END) AS runningCount,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completedCount,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failedCount
        FROM batch_items
        WHERE batch_id = ?
      `,
      )
      .get(batchId) as BatchStatusRow

    return toBatchProgress(batchId, row)
  }

  listBatchItems(batchId: string): BatchItemRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          batch_id AS batchId,
          task_id AS taskId,
          youtube_url AS youtubeUrl,
          status,
          reject_reason AS rejectReason,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM batch_items
        WHERE batch_id = ?
        ORDER BY id ASC
      `,
      )
      .all(batchId) as BatchItemRow[]

    return rows.map(mapBatchItem)
  }

  private syncBatchStatus(batchId: string): void {
    const progress = this.getBatchProgress(batchId)
    const now = new Date().toISOString()
    const terminal = progress.total > 0 && progress.completed + progress.failed >= progress.total

    let status: BatchStatus = 'created'
    if (terminal) {
      if (progress.completed === progress.total) {
        status = 'completed'
      } else if (progress.failed === progress.total) {
        status = 'failed'
      } else {
        status = 'partial'
      }
    } else if (progress.running > 0 || progress.queued > 0) {
      status = 'running'
    }

    const counts = this.db
      .prepare(
        `
        SELECT
          COUNT(CASE WHEN status <> 'rejected' THEN 1 END) AS acceptedCount,
          COUNT(CASE WHEN status = 'rejected' THEN 1 END) AS rejectedCount
        FROM batch_items
        WHERE batch_id = ?
      `,
      )
      .get(batchId) as { acceptedCount: number; rejectedCount: number }

    this.db
      .prepare(
        `
        UPDATE batches
        SET
          accepted_count = ?,
          rejected_count = ?,
          status = ?,
          completed_at = ?,
          updated_at = ?
        WHERE id = ?
      `,
      )
      .run(
        counts.acceptedCount,
        counts.rejectedCount,
        status,
        terminal ? now : null,
        now,
        batchId,
      )
  }

  private getBatchRecordById(batchId: string): BatchRecord {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          name,
          total_count AS totalCount,
          accepted_count AS acceptedCount,
          rejected_count AS rejectedCount,
          status,
          created_at AS createdAt,
          updated_at AS updatedAt,
          completed_at AS completedAt
        FROM batches
        WHERE id = ?
      `,
      )
      .get(batchId) as BatchRow | undefined

    if (!row) {
      throw new Error(`Batch not found: ${batchId}`)
    }

    return mapBatch(row)
  }
}
