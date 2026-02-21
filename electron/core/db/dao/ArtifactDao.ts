import type Database from 'better-sqlite3'
import type { ArtifactRecord, ArtifactType } from '../types'

interface ArtifactRow {
  id: number
  taskId: string
  artifactType: ArtifactType
  filePath: string
  fileSize: number | null
  mimeType: string | null
  createdAt: string
}

function mapArtifact(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    artifactType: row.artifactType,
    filePath: row.filePath,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    createdAt: row.createdAt,
  }
}

export class ArtifactDao {
  constructor(private readonly db: Database.Database) {}

  addArtifact(input: {
    taskId: string
    artifactType: ArtifactType
    filePath: string
    fileSize?: number | null
    mimeType?: string | null
  }): ArtifactRecord {
    const now = new Date().toISOString()
    const info = this.db
      .prepare(
        `
        INSERT INTO artifacts(task_id, artifact_type, file_path, file_size, mime_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        input.taskId,
        input.artifactType,
        input.filePath,
        input.fileSize ?? null,
        input.mimeType ?? null,
        now,
      )

    return this.getArtifactById(Number(info.lastInsertRowid))
  }

  listArtifacts(taskId: string): ArtifactRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          id,
          task_id AS taskId,
          artifact_type AS artifactType,
          file_path AS filePath,
          file_size AS fileSize,
          mime_type AS mimeType,
          created_at AS createdAt
        FROM artifacts
        WHERE task_id = ?
        ORDER BY id ASC
      `,
      )
      .all(taskId) as ArtifactRow[]

    return rows.map(mapArtifact)
  }

  deleteByTaskId(taskId: string): number {
    const info = this.db.prepare('DELETE FROM artifacts WHERE task_id = ?').run(taskId)
    return info.changes
  }

  private getArtifactById(id: number): ArtifactRecord {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          task_id AS taskId,
          artifact_type AS artifactType,
          file_path AS filePath,
          file_size AS fileSize,
          mime_type AS mimeType,
          created_at AS createdAt
        FROM artifacts
        WHERE id = ?
      `,
      )
      .get(id) as ArtifactRow | undefined

    if (!row) {
      throw new Error(`Artifact not found: ${id}`)
    }

    return mapArtifact(row)
  }
}

