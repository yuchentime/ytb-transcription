import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { runMigrations } from './migrate'
import { ArtifactDao, SettingsDao, TaskDao, TaskStepDao } from './dao'

export interface DatabaseContext {
  dbPath: string
  db: Database.Database
  taskDao: TaskDao
  taskStepDao: TaskStepDao
  artifactDao: ArtifactDao
  settingsDao: SettingsDao
}

let context: DatabaseContext | null = null

export function resolveDatabasePath(options?: { dataRoot?: string; dbPath?: string }): string {
  if (options?.dbPath) return options.dbPath
  const root = options?.dataRoot ?? app.getPath('userData')
  return path.join(root, 'app.db')
}

export function initDatabase(options?: { dataRoot?: string; dbPath?: string }): DatabaseContext {
  if (context) return context

  const dbPath = resolveDatabasePath(options)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  const taskDao = new TaskDao(db)
  const taskStepDao = new TaskStepDao(db)
  const artifactDao = new ArtifactDao(db)
  const settingsDao = new SettingsDao(db)
  settingsDao.initializeDefaults()

  context = {
    dbPath,
    db,
    taskDao,
    taskStepDao,
    artifactDao,
    settingsDao,
  }

  return context
}

export function getDatabaseContext(): DatabaseContext {
  if (!context) {
    throw new Error('Database is not initialized. Call initDatabase() first.')
  }
  return context
}

export function closeDatabase(): void {
  if (!context) return
  context.db.close()
  context = null
}
