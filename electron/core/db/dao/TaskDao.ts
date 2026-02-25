import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { CreateTaskInput, HistoryListResult, HistoryQuery, TaskRecord, TaskStatus } from '../types'

interface TaskRow {
  id: string
  youtubeUrl: string
  youtubeTitle: string | null
  youtubeAuthor: string | null
  status: TaskStatus
  sourceLanguage: string | null
  targetLanguage: string
  whisperModel: string | null
  provider: 'minimax'
  translateProvider: 'minimax' | 'deepseek' | 'glm' | 'kimi' | 'custom'
  ttsProvider: 'minimax' | 'openai' | 'glm' | 'qwen' | 'piper'
  translateModelId: string | null
  ttsModelId: string | null
  ttsVoice: string | null
  modelConfigSnapshot: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

function parseSnapshot(snapshot: string | null): Record<string, unknown> | null {
  if (!snapshot) return null
  try {
    return JSON.parse(snapshot) as Record<string, unknown>
  } catch {
    return null
  }
}

function sanitizePagination(page?: number, pageSize?: number): { page: number; pageSize: number } {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page as number)) : 1
  const safePageSize = Number.isFinite(pageSize)
    ? Math.min(100, Math.max(1, Math.floor(pageSize as number)))
    : 20
  return { page: safePage, pageSize: safePageSize }
}

function mapTask(row: TaskRow): TaskRecord {
  const rawTtsProvider = (row.ttsProvider ?? row.provider ?? 'minimax') as string
  const normalizedTtsProvider =
    rawTtsProvider === 'piper' || rawTtsProvider === 'custom'
      ? 'minimax'
      : rawTtsProvider === 'glm' || rawTtsProvider === 'openai' || rawTtsProvider === 'qwen'
        ? rawTtsProvider
        : 'minimax'
  return {
    id: row.id,
    youtubeUrl: row.youtubeUrl,
    youtubeTitle: row.youtubeTitle,
    youtubeAuthor: row.youtubeAuthor,
    status: row.status,
    sourceLanguage: row.sourceLanguage,
    targetLanguage: row.targetLanguage,
    whisperModel: row.whisperModel,
    provider: row.provider,
    // Fallback to legacy provider field if new fields are not set
    translateProvider: row.translateProvider ?? row.provider ?? 'minimax',
    ttsProvider: normalizedTtsProvider,
    translateModelId: row.translateModelId,
    ttsModelId: row.ttsModelId,
    ttsVoice: row.ttsVoice,
    modelConfigSnapshot: parseSnapshot(row.modelConfigSnapshot),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
  }
}

export class TaskDao {
  constructor(private readonly db: Database.Database) {}

  createTask(input: CreateTaskInput): TaskRecord {
    const id = randomUUID()
    const now = new Date().toISOString()
    const modelConfigSnapshot = input.modelConfigSnapshot
      ? JSON.stringify(input.modelConfigSnapshot)
      : null

    // Determine providers - use new fields if provided, fall back to legacy provider field
    const translateProvider = input.translateProvider ?? input.provider ?? 'minimax'
    const requestedTtsProvider = (input.ttsProvider ?? input.provider ?? 'minimax') as string
    const ttsProvider =
      requestedTtsProvider === 'piper' || requestedTtsProvider === 'custom'
        ? 'minimax'
        : requestedTtsProvider

    this.db
      .prepare(
        `
        INSERT INTO tasks(
          id, youtube_url, youtube_title, youtube_author, status, source_language, target_language, whisper_model,
          provider, translate_provider, tts_provider, translate_model_id, tts_model_id, tts_voice, model_config_snapshot,
          error_code, error_message, created_at, updated_at, completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        input.youtubeUrl,
        input.youtubeTitle ?? null,
        input.youtubeAuthor ?? null,
        'idle',
        input.sourceLanguage ?? null,
        input.targetLanguage ?? 'zh',
        input.whisperModel ?? null,
        input.provider ?? 'minimax',
        translateProvider,
        ttsProvider,
        input.translateModelId ?? null,
        input.ttsModelId ?? null,
        input.ttsVoice ?? null,
        modelConfigSnapshot,
        null,
        null,
        now,
        now,
        null,
      )

    return this.getTaskById(id)
  }

  updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    patch?: {
      errorCode?: string | null
      errorMessage?: string | null
      completedAt?: string | null
      sourceLanguage?: string | null
      targetLanguage?: string
      whisperModel?: string | null
      ttsVoice?: string | null
      translateModelId?: string | null
      ttsModelId?: string | null
      modelConfigSnapshot?: Record<string, unknown> | null
    },
  ): TaskRecord {
    const now = new Date().toISOString()
    const completedAt =
      patch?.completedAt !== undefined
        ? patch.completedAt
        : status === 'completed'
          ? now
          : null

    const modelConfigSnapshot =
      patch?.modelConfigSnapshot !== undefined
        ? patch.modelConfigSnapshot
          ? JSON.stringify(patch.modelConfigSnapshot)
          : null
        : null

    this.db
      .prepare(
        `
        UPDATE tasks
        SET
          status = ?,
          error_code = ?,
          error_message = ?,
          source_language = COALESCE(?, source_language),
          target_language = COALESCE(?, target_language),
          whisper_model = COALESCE(?, whisper_model),
          tts_voice = COALESCE(?, tts_voice),
          translate_model_id = COALESCE(?, translate_model_id),
          tts_model_id = COALESCE(?, tts_model_id),
          model_config_snapshot = COALESCE(?, model_config_snapshot),
          updated_at = ?,
          completed_at = ?
        WHERE id = ?
      `,
      )
      .run(
        status,
        patch?.errorCode ?? null,
        patch?.errorMessage ?? null,
        patch?.sourceLanguage ?? null,
        patch?.targetLanguage ?? null,
        patch?.whisperModel ?? null,
        patch?.ttsVoice ?? null,
        patch?.translateModelId ?? null,
        patch?.ttsModelId ?? null,
        modelConfigSnapshot,
        now,
        completedAt,
        taskId,
      )

    return this.getTaskById(taskId)
  }

  updateTaskMetadata(
    taskId: string,
    patch: {
      youtubeTitle?: string | null
      youtubeAuthor?: string | null
    },
  ): TaskRecord {
    const now = new Date().toISOString()
    const hasTitle = patch.youtubeTitle !== undefined
    const hasAuthor = patch.youtubeAuthor !== undefined
    if (!hasTitle && !hasAuthor) {
      return this.getTaskById(taskId)
    }

    this.db
      .prepare(
        `
        UPDATE tasks
        SET
          youtube_title = CASE WHEN ? THEN ? ELSE youtube_title END,
          youtube_author = CASE WHEN ? THEN ? ELSE youtube_author END,
          updated_at = ?
        WHERE id = ?
      `,
      )
      .run(
        hasTitle ? 1 : 0,
        hasTitle ? patch.youtubeTitle ?? null : null,
        hasAuthor ? 1 : 0,
        hasAuthor ? patch.youtubeAuthor ?? null : null,
        now,
        taskId,
      )

    return this.getTaskById(taskId)
  }

  getTaskById(taskId: string): TaskRecord {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          youtube_url AS youtubeUrl,
          youtube_title AS youtubeTitle,
          youtube_author AS youtubeAuthor,
          status,
          source_language AS sourceLanguage,
          target_language AS targetLanguage,
          whisper_model AS whisperModel,
          provider,
          translate_provider AS translateProvider,
          tts_provider AS ttsProvider,
          translate_model_id AS translateModelId,
          tts_model_id AS ttsModelId,
          tts_voice AS ttsVoice,
          model_config_snapshot AS modelConfigSnapshot,
          error_code AS errorCode,
          error_message AS errorMessage,
          created_at AS createdAt,
          updated_at AS updatedAt,
          completed_at AS completedAt
        FROM tasks
        WHERE id = ?
      `,
      )
      .get(taskId) as TaskRow | undefined

    if (!row) {
      throw new Error(`Task not found: ${taskId}`)
    }
    return mapTask(row)
  }

  listTasks(query: HistoryQuery = {}): HistoryListResult {
    const { page, pageSize } = sanitizePagination(query.page, query.pageSize)
    const offset = (page - 1) * pageSize

    const where: string[] = []
    const params: unknown[] = []

    if (query.status) {
      where.push('status = ?')
      params.push(query.status)
    }

    if (query.targetLanguage) {
      where.push('target_language = ?')
      params.push(query.targetLanguage)
    }

    if (query.keyword?.trim()) {
      const keyword = `%${query.keyword.trim()}%`
      where.push('(youtube_url LIKE ? OR IFNULL(youtube_title, \'\') LIKE ? OR IFNULL(youtube_author, \'\') LIKE ?)')
      params.push(keyword, keyword, keyword)
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const totalRow = this.db
      .prepare(`SELECT COUNT(1) AS total FROM tasks ${whereSql}`)
      .get(...params) as { total: number }

    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          youtube_url AS youtubeUrl,
          youtube_title AS youtubeTitle,
          youtube_author AS youtubeAuthor,
          status,
          source_language AS sourceLanguage,
          target_language AS targetLanguage,
          whisper_model AS whisperModel,
          provider,
          translate_provider AS translateProvider,
          tts_provider AS ttsProvider,
          translate_model_id AS translateModelId,
          tts_model_id AS ttsModelId,
          tts_voice AS ttsVoice,
          model_config_snapshot AS modelConfigSnapshot,
          error_code AS errorCode,
          error_message AS errorMessage,
          created_at AS createdAt,
          updated_at AS updatedAt,
          completed_at AS completedAt
        FROM tasks
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `,
      )
      .all(...params, pageSize, offset) as TaskRow[]

    return {
      items: rows.map(mapTask),
      total: totalRow.total,
      page,
      pageSize,
    }
  }

  findRunningTask(): TaskRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          youtube_url AS youtubeUrl,
          youtube_title AS youtubeTitle,
          youtube_author AS youtubeAuthor,
          status,
          source_language AS sourceLanguage,
          target_language AS targetLanguage,
          whisper_model AS whisperModel,
          provider,
          translate_provider AS translateProvider,
          tts_provider AS ttsProvider,
          translate_model_id AS translateModelId,
          tts_model_id AS ttsModelId,
          tts_voice AS ttsVoice,
          model_config_snapshot AS modelConfigSnapshot,
          error_code AS errorCode,
          error_message AS errorMessage,
          created_at AS createdAt,
          updated_at AS updatedAt,
          completed_at AS completedAt
        FROM tasks
        WHERE status IN ('queued', 'downloading', 'extracting', 'transcribing', 'translating', 'synthesizing', 'merging')
        ORDER BY updated_at ASC
        LIMIT 1
      `,
      )
      .get() as TaskRow | undefined

    return row ? mapTask(row) : null
  }

  deleteTask(taskId: string): number {
    const info = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
    return info.changes
  }

  deleteTaskCascade(taskId: string): {
    taskDeleted: boolean
    stepsDeleted: number
    artifactsDeleted: number
  } {
    const transaction = this.db.transaction((id: string) => {
      const stepsDeleted = this.db.prepare('DELETE FROM task_steps WHERE task_id = ?').run(id).changes
      const artifactsDeleted = this.db.prepare('DELETE FROM artifacts WHERE task_id = ?').run(id).changes
      const taskDeleted = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes
      return {
        taskDeleted: taskDeleted > 0,
        stepsDeleted,
        artifactsDeleted,
      }
    })

    return transaction(taskId)
  }
}
