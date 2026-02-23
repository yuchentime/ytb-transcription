import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { SCHEMA_SQL } from './schema'

const LATEST_SCHEMA_VERSION = 5
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

function resolveMigrationPath(fileName: string): string | null {
  const candidates = [
    path.join(process.env.APP_ROOT ?? '', 'electron', 'core', 'db', 'migrations', fileName),
    path.join(process.cwd(), 'electron', 'core', 'db', 'migrations', fileName),
    path.join(__dirname, 'migrations', fileName),
  ]

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function applyVersion2(db: Database.Database): void {
  const migrationPath = resolveMigrationPath('002_add_segment_tables.sql')
  if (!migrationPath) {
    throw new Error('Cannot find migration file: 002_add_segment_tables.sql')
  }
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8')
  const now = new Date().toISOString()

  const applyMigration = db.transaction(() => {
    db.exec(migrationSql)
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(2, now)
  })

  applyMigration()
}

function applyVersion3(db: Database.Database): void {
  const migrationPath = resolveMigrationPath('003_add_provider_fields.sql')
  if (!migrationPath) {
    throw new Error('Cannot find migration file: 003_add_provider_fields.sql')
  }
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8')
  const now = new Date().toISOString()

  const applyMigration = db.transaction(() => {
    db.exec(migrationSql)
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(3, now)
  })

  applyMigration()
}

function applyVersion4(db: Database.Database): void {
  const migrationPath = resolveMigrationPath('004_tts_provider_custom_to_piper.sql')
  if (!migrationPath) {
    throw new Error('Cannot find migration file: 004_tts_provider_custom_to_piper.sql')
  }
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8')
  const now = new Date().toISOString()

  const applyMigration = db.transaction(() => {
    db.exec(migrationSql)
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(4, now)
  })

  applyMigration()
}

function applyVersion5(db: Database.Database): void {
  const migrationPath = resolveMigrationPath('005_add_batch_queue_tables.sql')
  if (!migrationPath) {
    throw new Error('Cannot find migration file: 005_add_batch_queue_tables.sql')
  }
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8')
  const now = new Date().toISOString()

  const applyMigration = db.transaction(() => {
    db.exec(migrationSql)
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(5, now)
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

  if (currentVersion < 2) {
    applyVersion2(db)
  }

  if (currentVersion < 3) {
    applyVersion3(db)
  }

  if (currentVersion < 4) {
    applyVersion4(db)
  }

  if (currentVersion < 5) {
    applyVersion5(db)
  }
}
