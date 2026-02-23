import type Database from 'better-sqlite3'
import type { AppSettings } from '../types'

interface SettingRow {
  key: string
  value: string
}

const DEFAULT_SETTINGS: AppSettings = {
  // Translation provider settings
  translateProvider: 'minimax',
  translateModelId: 'MiniMax-M2.5',
  translateTemperature: 0.3,

  // TTS provider settings
  ttsProvider: 'minimax',
  ttsModelId: '',
  ttsTargetLanguage: 'zh',
  ttsVoiceId: '',
  ttsSpeed: 1,
  ttsPitch: 0,
  ttsVolume: 1,

  // Provider-specific API configurations
  // MiniMax
  minimaxApiKey: '',
  minimaxApiBaseUrl: 'https://api.minimaxi.com',

  // DeepSeek
  deepseekApiKey: '',
  deepseekApiBaseUrl: 'https://api.deepseek.com',

  // GLM
  glmApiKey: '',
  glmApiBaseUrl: 'https://open.bigmodel.cn/api/paas',

  // Kimi
  kimiApiKey: '',
  kimiApiBaseUrl: 'https://api.moonshot.cn',

  // Custom/Local provider (e.g., LM Studio with OpenAI-compatible API)
  customApiKey: '',
  customApiBaseUrl: 'http://localhost:1234/v1', // LM Studio OpenAI-compatible API endpoint

  // Built-in Piper local TTS
  piperExecutablePath: '',
  piperModelPath: '',
  piperConfigPath: '',
  piperSpeakerId: 0,
  piperLengthScale: 1,
  piperNoiseScale: 0.667,
  piperNoiseW: 0.8,

  // YouTube download settings
  ytDlpAuthMode: 'none',
  ytDlpCookiesBrowser: 'chrome',
  ytDlpCookiesFilePath: '',

  // Transcription settings
  defaultWhisperModel: 'base',

  // Default target language
  defaultTargetLanguage: 'zh',

  // Timeout and retry settings
  stageTimeoutMs: 10 * 60 * 1000,
  retryPolicy: {
    download: 2,
    translate: 2,
    tts: 2,
    transcribe: 0,
  },

  // Deprecated: kept for backward compatibility
  provider: 'minimax',
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
    // eslint-disable-next-line no-extra-semi
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

function assertValidTranslateProvider(
  provider: unknown,
): asserts provider is AppSettings['translateProvider'] {
  if (
    provider === 'minimax' ||
    provider === 'deepseek' ||
    provider === 'glm' ||
    provider === 'kimi' ||
    provider === 'custom'
  ) {
    return
  }
  throw new Error('Invalid translateProvider')
}

function assertValidTtsProvider(
  provider: unknown,
): asserts provider is AppSettings['ttsProvider'] {
  if (provider === 'minimax' || provider === 'glm' || provider === 'piper') {
    return
  }
  throw new Error('Invalid ttsProvider')
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

    // Migrate old provider field to new translateProvider if needed
    if (!persisted.translateProvider && merged.provider) {
      merged.translateProvider = merged.provider as AppSettings['translateProvider']
    }
    if (!persisted.ttsProvider && merged.provider) {
      merged.ttsProvider = merged.provider as AppSettings['ttsProvider']
    }
    if ((merged.ttsProvider as unknown) === 'custom') {
      merged.ttsProvider = 'piper'
    }
    return merged
  }

  upsertSettings(patch: Partial<AppSettings>): AppSettings {
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
    if (patch.translateProvider !== undefined) {
      assertValidTranslateProvider(patch.translateProvider)
    }
    if (patch.ttsProvider !== undefined) {
      assertValidTtsProvider(patch.ttsProvider)
    }
    if (patch.piperExecutablePath !== undefined && typeof patch.piperExecutablePath !== 'string') {
      throw new Error('piperExecutablePath must be a string')
    }
    if (patch.piperModelPath !== undefined && typeof patch.piperModelPath !== 'string') {
      throw new Error('piperModelPath must be a string')
    }
    if (patch.piperConfigPath !== undefined && typeof patch.piperConfigPath !== 'string') {
      throw new Error('piperConfigPath must be a string')
    }
    if (
      patch.piperSpeakerId !== undefined &&
      (typeof patch.piperSpeakerId !== 'number' || !Number.isFinite(patch.piperSpeakerId))
    ) {
      throw new Error('piperSpeakerId must be a finite number')
    }
    if (
      patch.piperLengthScale !== undefined &&
      (typeof patch.piperLengthScale !== 'number' || !Number.isFinite(patch.piperLengthScale))
    ) {
      throw new Error('piperLengthScale must be a finite number')
    }
    if (
      patch.piperNoiseScale !== undefined &&
      (typeof patch.piperNoiseScale !== 'number' || !Number.isFinite(patch.piperNoiseScale))
    ) {
      throw new Error('piperNoiseScale must be a finite number')
    }
    if (
      patch.piperNoiseW !== undefined &&
      (typeof patch.piperNoiseW !== 'number' || !Number.isFinite(patch.piperNoiseW))
    ) {
      throw new Error('piperNoiseW must be a finite number')
    }

    const normalizedPatch: Partial<AppSettings> = { ...patch }

    if (normalizedPatch.ytDlpCookiesFilePath !== undefined) {
      normalizedPatch.ytDlpCookiesFilePath = normalizedPatch.ytDlpCookiesFilePath.trim()
    }
    if (normalizedPatch.piperExecutablePath !== undefined) {
      normalizedPatch.piperExecutablePath = normalizedPatch.piperExecutablePath.trim()
    }
    if (normalizedPatch.piperModelPath !== undefined) {
      normalizedPatch.piperModelPath = normalizedPatch.piperModelPath.trim()
    }
    if (normalizedPatch.piperConfigPath !== undefined) {
      normalizedPatch.piperConfigPath = normalizedPatch.piperConfigPath.trim()
    }

    // Trim all base URL fields
    const baseUrlFields: (keyof AppSettings)[] = [
      'minimaxApiBaseUrl',
      'deepseekApiBaseUrl',
      'glmApiBaseUrl',
      'kimiApiBaseUrl',
      'customApiBaseUrl',
    ]
    for (const field of baseUrlFields) {
      if (field in normalizedPatch && typeof normalizedPatch[field] === 'string') {
        (normalizedPatch as Record<string, string>)[field] = (normalizedPatch[field] as string).trim()
      }
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
    if (candidate.ttsProvider === 'piper' && !candidate.piperModelPath.trim()) {
      throw new Error('piperModelPath is required when ttsProvider=piper')
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
    const translateProvider = settings.translateProvider ?? 'minimax'
    const ttsProvider = settings.ttsProvider ?? 'minimax'

    // Validate translate provider API key/base URL
    const translateApiKeyField = this.getApiKeyField(translateProvider)
    const translateBaseUrlField = this.getBaseUrlField(translateProvider)
    if (translateProvider !== 'custom' && !settings[translateApiKeyField]) {
      errors.push(`${translateProvider} API key is required for translation`)
    }
    if (!settings[translateBaseUrlField]) {
      errors.push(`${translateProvider} API base URL is required for translation`)
    }

    // Validate TTS provider API key/base URL
    if (ttsProvider === 'piper') {
      if (!settings.piperModelPath?.trim()) {
        errors.push('piperModelPath is required for TTS')
      }
    } else {
      const ttsApiKeyField = this.getApiKeyField(ttsProvider)
      const ttsBaseUrlField = this.getBaseUrlField(ttsProvider)
      if (!settings[ttsApiKeyField]) {
        errors.push(`${ttsProvider} API key is required for TTS`)
      }
      if (!settings[ttsBaseUrlField]) {
        errors.push(`${ttsProvider} API base URL is required for TTS`)
      }
    }

    if (!settings.translateModelId) {
      errors.push('translateModelId is required')
    }

    if (ttsProvider !== 'piper' && !settings.ttsModelId) {
      errors.push('ttsModelId is required')
    }

    return errors
  }

  private getApiKeyField(provider: AppSettings['translateProvider'] | AppSettings['ttsProvider']): keyof AppSettings {
    switch (provider) {
      case 'minimax':
        return 'minimaxApiKey'
      case 'deepseek':
        return 'deepseekApiKey'
      case 'glm':
        return 'glmApiKey'
      case 'kimi':
        return 'kimiApiKey'
      case 'custom':
        return 'customApiKey'
      case 'piper':
        return 'customApiKey'
    }
  }

  private getBaseUrlField(provider: AppSettings['translateProvider'] | AppSettings['ttsProvider']): keyof AppSettings {
    switch (provider) {
      case 'minimax':
        return 'minimaxApiBaseUrl'
      case 'deepseek':
        return 'deepseekApiBaseUrl'
      case 'glm':
        return 'glmApiBaseUrl'
      case 'kimi':
        return 'kimiApiBaseUrl'
      case 'custom':
        return 'customApiBaseUrl'
      case 'piper':
        return 'customApiBaseUrl'
    }
  }
}

export { DEFAULT_SETTINGS }
