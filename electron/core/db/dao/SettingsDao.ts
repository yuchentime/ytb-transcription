import type Database from 'better-sqlite3'
import type { AppSettings } from '../types'

interface SettingRow {
  key: string
  value: string
}

const DEFAULT_SETTINGS: AppSettings = {
  provider: 'minimax',
  ytDlpAuthMode: 'none',
  ytDlpCookiesBrowser: 'chrome',
  ytDlpCookiesFilePath: '',
  defaultWhisperModel: 'base',
  minimaxApiKey: '',
  minimaxApiBaseUrl: 'https://api.minimaxi.com',
  translateModelId: '',
  translateTemperature: 0.3,
  ttsModelId: '',
  ttsVoiceId: '',
  ttsSpeed: 1,
  ttsPitch: 0,
  ttsVolume: 1,
  defaultTargetLanguage: 'zh',
  stageTimeoutMs: 10 * 60 * 1000,
  retryPolicy: {
    download: 2,
    translate: 2,
    tts: 2,
    transcribe: 0,
  },
}

function decodeSettingValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function encodeSettingValue(value: unknown): string {
  return JSON.stringify(value)
}

function parseRowsToSettings(rows: SettingRow[]): Partial<AppSettings> {
  const partial: Partial<AppSettings> = {}
  for (const row of rows) {
    ;(partial as Record<string, unknown>)[row.key] = decodeSettingValue(row.value)
  }
  return partial
}

function assertValidYtDlpAuthMode(mode: unknown): asserts mode is AppSettings['ytDlpAuthMode'] {
  if (mode === 'none' || mode === 'browser_cookies' || mode === 'cookies_file') return
  throw new Error('Invalid ytDlpAuthMode')
}

function assertValidYtDlpBrowser(
  browser: unknown,
): asserts browser is AppSettings['ytDlpCookiesBrowser'] {
  if (
    browser === 'chrome' ||
    browser === 'chromium' ||
    browser === 'edge' ||
    browser === 'firefox' ||
    browser === 'safari' ||
    browser === 'brave'
  ) {
    return
  }
  throw new Error('Invalid ytDlpCookiesBrowser')
}

function assertValidWhisperModel(
  model: unknown,
): asserts model is AppSettings['defaultWhisperModel'] {
  if (
    model === 'tiny' ||
    model === 'base' ||
    model === 'small' ||
    model === 'medium' ||
    model === 'large'
  ) {
    return
  }
  throw new Error('Invalid defaultWhisperModel')
}

export class SettingsDao {
  constructor(private readonly db: Database.Database) {}

  initializeDefaults(): AppSettings {
    const rows = this.db.prepare('SELECT key FROM settings').all() as Array<{ key: string }>
    const existingKeys = new Set(rows.map((row) => row.key))
    const now = new Date().toISOString()
    const statement = this.db.prepare(
      `
      INSERT INTO settings(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO NOTHING
    `,
    )

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (existingKeys.has(key)) continue
      statement.run(key, encodeSettingValue(value), now)
    }

    // Provider is fixed to minimax in MVP.
    this.setValue('provider', 'minimax')
    return this.getSettings()
  }

  getSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as SettingRow[]
    const persisted = parseRowsToSettings(rows)

    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...persisted,
      retryPolicy: {
        ...DEFAULT_SETTINGS.retryPolicy,
        ...(persisted.retryPolicy ?? {}),
      },
    }

    // Provider is intentionally fixed in MVP.
    merged.provider = 'minimax'
    return merged
  }

  upsertSettings(patch: Partial<AppSettings>): AppSettings {
    if (patch.provider && patch.provider !== 'minimax') {
      throw new Error('Only MiniMax provider is supported in MVP')
    }

    if (patch.ytDlpAuthMode !== undefined) {
      assertValidYtDlpAuthMode(patch.ytDlpAuthMode)
    }
    if (patch.ytDlpCookiesBrowser !== undefined) {
      assertValidYtDlpBrowser(patch.ytDlpCookiesBrowser)
    }
    if (
      patch.ytDlpCookiesFilePath !== undefined &&
      typeof patch.ytDlpCookiesFilePath !== 'string'
    ) {
      throw new Error('ytDlpCookiesFilePath must be a string')
    }
    if (patch.defaultWhisperModel !== undefined) {
      assertValidWhisperModel(patch.defaultWhisperModel)
    }

    const normalizedPatch: Partial<AppSettings> = {
      ...patch,
      provider: 'minimax',
    }

    if (normalizedPatch.ytDlpCookiesFilePath !== undefined) {
      normalizedPatch.ytDlpCookiesFilePath = normalizedPatch.ytDlpCookiesFilePath.trim()
    }

    const current = this.getSettings()
    const candidate: AppSettings = {
      ...current,
      ...normalizedPatch,
      retryPolicy: {
        ...current.retryPolicy,
        ...(normalizedPatch.retryPolicy ?? {}),
      },
    }
    if (candidate.ytDlpAuthMode === 'cookies_file' && !candidate.ytDlpCookiesFilePath.trim()) {
      throw new Error('ytDlpCookiesFilePath is required when ytDlpAuthMode=cookies_file')
    }

    const now = new Date().toISOString()
    const statement = this.db.prepare(`
      INSERT INTO settings(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)

    for (const [key, value] of Object.entries(normalizedPatch)) {
      if (value === undefined) continue
      statement.run(key, encodeSettingValue(value), now)
    }

    return this.getSettings()
  }

  getValue<T = unknown>(key: keyof AppSettings): T | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (!row) return null
    return decodeSettingValue(row.value) as T
  }

  setValue(key: keyof AppSettings, value: unknown): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `
        INSERT INTO settings(key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `,
      )
      .run(key, encodeSettingValue(value), now)
  }

  validateModelSettings(settings: Partial<AppSettings> = this.getSettings()): string[] {
    const errors: string[] = []
    const provider = settings.provider ?? 'minimax'

    if (provider !== 'minimax') {
      errors.push('Provider must be minimax in MVP')
    }

    if (!settings.translateModelId) {
      errors.push('translateModelId is required')
    }

    if (!settings.ttsModelId) {
      errors.push('ttsModelId is required')
    }

    return errors
  }
}

export { DEFAULT_SETTINGS }
