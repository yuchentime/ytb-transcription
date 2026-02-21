import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { SCHEMA_SQL } from './schema'

const LATEST_SCHEMA_VERSION = 1
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolveSchemaPath(): string | null {
  const candidates = [
    path.join(process.env.APP_ROOT ?? '', 'electron', 'core', 'db', 'schema.sql'),
    path.join(process.cwd(), 'electron', 'core', 'db', 'schema.sql'),
    path.join(__dirname, 'schema.sql'),
  ]

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)
}

function getCurrentVersion(db: Database.Database): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
    .get() as { version: number } | undefined

  return row?.version ?? 0
}

function applyVersion1(db: Database.Database): void {
  const schemaPath = resolveSchemaPath()
  const schemaSql = schemaPath ? fs.readFileSync(schemaPath, 'utf-8') : SCHEMA_SQL
  const now = new Date().toISOString()

  const applyMigration = db.transaction(() => {
    db.exec(schemaSql)
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(1, now)
  })

  applyMigration()
}

export function runMigrations(db: Database.Database): void {
  ensureMigrationsTable(db)

  const currentVersion = getCurrentVersion(db)
  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version (${currentVersion}) is newer than app supports (${LATEST_SCHEMA_VERSION})`,
    )
  }

  if (currentVersion < 1) {
    applyVersion1(db)
  }
}
