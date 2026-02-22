import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings, TranslateProvider, TtsProvider } from '../../electron/core/db/types'
import type { TranslateFn } from '../app/i18n'
import { translateLanguageLabel } from '../app/i18n'
import { VoicePresetPanel } from '../components/VoicePresetPanel'
import { Toast } from '../components/Toast'
import { TRANSLATE_MODEL_OPTIONS, TTS_MODEL_OPTIONS } from '../app/utils'

// Translation provider options
const TRANSLATE_PROVIDERS: { value: TranslateProvider; label: string }[] = [
  { value: 'minimax', label: 'MiniMax' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'glm', label: 'GLM (智谱AI)' },
  { value: 'kimi', label: 'Kimi (Moonshot)' },
  { value: 'custom', label: '自定义 / Local (LM Studio等)' },
]

// TTS provider options
const TTS_PROVIDERS: { value: TtsProvider; label: string }[] = [
  { value: 'minimax', label: 'MiniMax' },
  { value: 'glm', label: 'GLM (智谱AI)' },
  { value: 'custom', label: '自定义 / Local' },
]

// Default base URLs for providers
const DEFAULT_BASE_URLS: Record<Exclude<TranslateProvider | TtsProvider, 'custom'>, string> = {
  minimax: 'https://api.minimaxi.com',
  deepseek: 'https://api.deepseek.com',
  glm: 'https://open.bigmodel.cn/api/paas',
  kimi: 'https://api.moonshot.cn',
}

interface SettingsPageModel {
  settings: AppSettings
  settingsLoading: boolean
  settingsSaving: boolean
  settingsError: string
  settingsSaveSuccess: boolean
  settingsSaveError: boolean
  settingsSaveErrorMessage: string
  defaultStageTimeoutMs: number
  voiceProfiles: Array<{
    id: string
    displayName: string
    description: string
    language: 'zh' | 'en' | 'ja' | 'multi'
    speedRange: [number, number]
    pitchRange: [number, number]
    volumeRange: [number, number]
  }>
  voiceValidationErrors: string[]
}

interface SettingsPageActions {
  setSettings: Dispatch<SetStateAction<AppSettings>>
  onSave(): Promise<void>
  clearSaveSuccess(): void
  clearSaveError(): void
}

interface SettingsPageProps {
  model: SettingsPageModel
  actions: SettingsPageActions
  t: TranslateFn
}

export function SettingsPage(props: SettingsPageProps) {
  const { settings } = props.model
  const { setSettings } = props.actions

  // Helper to get available models for a provider
  const getTranslateModels = (provider: TranslateProvider): string[] => {
    if (provider === 'custom') return []
    return TRANSLATE_MODEL_OPTIONS[provider] ?? []
  }

  const getTtsModels = (provider: TtsProvider): string[] => {
    if (provider === 'custom') return []
    return TTS_MODEL_OPTIONS[provider] ?? []
  }

  // Helper to get API key field name for a provider
  const getApiKeyField = (provider: TranslateProvider | TtsProvider): keyof AppSettings => {
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
        // For custom/local providers, use a generic custom API key field
        return 'customApiKey' as keyof AppSettings
    }
  }

  // Helper to get base URL field name for a provider
  const getBaseUrlField = (provider: TranslateProvider | TtsProvider): keyof AppSettings => {
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
        // For custom/local providers, use a generic custom base URL field
        return 'customApiBaseUrl' as keyof AppSettings
    }
  }

  return (
    <section className="panel main-panel settings-panel">
      <h1>{props.t('settings.title')}</h1>
      {props.model.settingsLoading && <p className="hint">{props.t('settings.loading')}</p>}

      {/* Group 1: Translation Provider Settings */}
      <div className="settings-group">
        <h3 className="settings-group-title">{props.t('settings.group.translation')}</h3>
        <div className="settings-group-content grid two-col">
          {/* Translation Provider Selection */}
          <label>
            {props.t('settings.translateProvider')}
            <select
              value={settings.translateProvider}
              onChange={(event) => {
                const newProvider = event.target.value as TranslateProvider
                const availableModels = getTranslateModels(newProvider)
                const currentModelValid = availableModels.includes(settings.translateModelId)
                setSettings((prev) => {
                  const baseUrlField = getBaseUrlField(newProvider)
                  const defaultBaseUrl = newProvider !== 'custom' ? DEFAULT_BASE_URLS[newProvider] : ''
                  return {
                    ...prev,
                    translateProvider: newProvider,
                    // Auto-select first available model if current model is not valid for new provider
                    translateModelId: currentModelValid ? prev.translateModelId : (availableModels[0] ?? ''),
                    // Auto-set default base URL if empty
                    [baseUrlField]: (prev[baseUrlField] as string) || defaultBaseUrl,
                  }
                })
              }}
            >
              {TRANSLATE_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          {/* Translation Provider API Key */}
          <label>
            {props.t('settings.translateApiKey', { provider: settings.translateProvider.toUpperCase() })}
            <input
              type="password"
              value={settings[getApiKeyField(settings.translateProvider)] as string}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  [getApiKeyField(prev.translateProvider)]: event.target.value,
                }))
              }
              placeholder="sk-..."
            />
          </label>

          {/* Translation Provider Base URL */}
          <label>
            {props.t('settings.translateBaseUrl', { provider: settings.translateProvider.toUpperCase() })}
            <input
              type="text"
              value={settings[getBaseUrlField(settings.translateProvider)] as string}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  [getBaseUrlField(prev.translateProvider)]: event.target.value.trim(),
                }))
              }
              placeholder={
                settings.translateProvider !== 'custom'
                  ? DEFAULT_BASE_URLS[settings.translateProvider]
                  : 'http://localhost:1234/v1 (OpenAI-compatible)'
              }
            />
          </label>

          {/* Translation Model ID */}
          <label>
            {props.t('settings.translateModelId')}
            {settings.translateProvider === 'custom' ? (
              <input
                type="text"
                value={settings.translateModelId}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    translateModelId: event.target.value,
                  }))
                }
                placeholder="如：llama-3.2-3b-instruct"
              />
            ) : (
              <select
                value={settings.translateModelId}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    translateModelId: event.target.value,
                  }))
                }
              >
                {getTranslateModels(settings.translateProvider).length === 0 && (
                  <option value="">{props.t('settings.selectModel')}</option>
                )}
                {getTranslateModels(settings.translateProvider).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>
      </div>

      {/* Group 2: TTS Provider Settings */}
      <div className="settings-group">
        <h3 className="settings-group-title">{props.t('settings.group.tts')}</h3>
        <div className="settings-group-content grid two-col">
          {/* TTS Provider Selection */}
          <label>
            {props.t('settings.ttsProvider')}
            <select
              value={settings.ttsProvider}
              onChange={(event) => {
                const newProvider = event.target.value as TtsProvider
                const availableModels = getTtsModels(newProvider)
                const currentModelValid = availableModels.includes(settings.ttsModelId)
                setSettings((prev) => {
                  const baseUrlField = getBaseUrlField(newProvider)
                  const defaultBaseUrl = newProvider !== 'custom' ? DEFAULT_BASE_URLS[newProvider] : ''
                  return {
                    ...prev,
                    ttsProvider: newProvider,
                    // Auto-select first available model if current model is not valid for new provider
                    ttsModelId: currentModelValid ? prev.ttsModelId : '',
                    // Auto-set default base URL if empty
                    [baseUrlField]: (prev[baseUrlField] as string) || defaultBaseUrl,
                  }
                })
              }}
            >
              {TTS_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          {/* TTS Provider API Key */}
          <label>
            {props.t('settings.ttsApiKey', { provider: settings.ttsProvider.toUpperCase() })}
            <input
              type="password"
              value={settings[getApiKeyField(settings.ttsProvider)] as string}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  [getApiKeyField(prev.ttsProvider)]: event.target.value,
                }))
              }
              placeholder="sk-..."
            />
          </label>

          {/* TTS Provider Base URL */}
          <label>
            {props.t('settings.ttsBaseUrl', { provider: settings.ttsProvider.toUpperCase() })}
            <input
              type="text"
              value={settings[getBaseUrlField(settings.ttsProvider)] as string}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  [getBaseUrlField(prev.ttsProvider)]: event.target.value.trim(),
                }))
              }
              placeholder={
                settings.ttsProvider !== 'custom'
                  ? DEFAULT_BASE_URLS[settings.ttsProvider]
                  : 'http://localhost:1234/v1 (OpenAI-compatible)'
              }
            />
          </label>

          {/* TTS Model ID */}
          <label>
            {props.t('settings.ttsModelId')}
            {settings.ttsProvider === 'custom' ? (
              <input
                type="text"
                value={settings.ttsModelId}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    ttsModelId: event.target.value,
                  }))
                }
                placeholder="如：local-tts-model"
              />
            ) : (
              <select
                value={settings.ttsModelId}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    ttsModelId: event.target.value,
                  }))
                }
              >
                <option value="">{props.t('settings.selectModel')}</option>
                {getTtsModels(settings.ttsProvider).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            )}
          </label>

          {/* Default Target Language */}
          <label>
            {props.t('settings.defaultTargetLanguage')}
            <select
              value={settings.defaultTargetLanguage}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  defaultTargetLanguage: event.target.value as 'zh' | 'en' | 'ja',
                }))
              }
            >
              <option value="zh">{translateLanguageLabel('zh', props.t)}</option>
              <option value="en">{translateLanguageLabel('en', props.t)}</option>
              <option value="ja">{translateLanguageLabel('ja', props.t)}</option>
            </select>
          </label>

          {/* Voice Preset Panel */}
          <div className="full">
            <VoicePresetPanel
              voiceId={settings.ttsVoiceId}
              speed={settings.ttsSpeed}
              pitch={settings.ttsPitch}
              volume={settings.ttsVolume}
              voiceProfiles={props.model.voiceProfiles}
              validationErrors={props.model.voiceValidationErrors}
              showAdvancedParams={false}
              setVoiceConfig={(updater) =>
                setSettings((prev) => {
                  const base = {
                    voiceId: prev.ttsVoiceId,
                    speed: prev.ttsSpeed,
                    pitch: prev.ttsPitch,
                    volume: prev.ttsVolume,
                  }
                  const next = typeof updater === 'function' ? updater(base) : updater
                  return {
                    ...prev,
                    ttsVoiceId: next.voiceId,
                    ttsSpeed: next.speed,
                    ttsPitch: next.pitch,
                    ttsVolume: next.volume,
                  }
                })
              }
            />
          </div>
        </div>
      </div>
      
      {/* Group 1: YouTube Download Settings */}
      <div className="settings-group">
        <h3 className="settings-group-title">{props.t('settings.group.youtube')}</h3>
        <div className="settings-group-content grid two-col">
          <label>
            {props.t('settings.youtubeDownloadAuth')}
            <select
              value={settings.ytDlpAuthMode}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  ytDlpAuthMode: event.target.value as AppSettings['ytDlpAuthMode'],
                }))
              }
            >
              <option value="none">{props.t('settings.auth.none')}</option>
              <option value="browser_cookies">{props.t('settings.auth.browserCookies')}</option>
              <option value="cookies_file">{props.t('settings.auth.cookiesFile')}</option>
            </select>
          </label>

          {settings.ytDlpAuthMode === 'browser_cookies' && (
            <label>
              {props.t('settings.cookiesBrowser')}
              <select
                value={settings.ytDlpCookiesBrowser}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    ytDlpCookiesBrowser: event.target.value as AppSettings['ytDlpCookiesBrowser'],
                  }))
                }
              >
                <option value="chrome">chrome</option>
                <option value="chromium">chromium</option>
                <option value="edge">edge</option>
                <option value="firefox">firefox</option>
                <option value="safari">safari</option>
                <option value="brave">brave</option>
              </select>
            </label>
          )}

          {settings.ytDlpAuthMode === 'cookies_file' && (
            <label className="full">
              {props.t('settings.cookiesFilePath')}
              <input
                type="text"
                value={settings.ytDlpCookiesFilePath}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    ytDlpCookiesFilePath: event.target.value,
                  }))
                }
                placeholder="/path/to/youtube-cookies.txt"
              />
            </label>
          )}
        </div>
      </div>

      {/* Group 2: Transcription Settings */}
      <div className="settings-group">
        <h3 className="settings-group-title">{props.t('settings.group.transcription')}</h3>
        <div className="settings-group-content grid two-col">
          <label>
            {props.t('settings.whisperModel')}
            <select
              value={settings.defaultWhisperModel}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  defaultWhisperModel: event.target.value as AppSettings['defaultWhisperModel'],
                }))
              }
            >
              <option value="tiny">tiny</option>
              <option value="base">base</option>
              <option value="small">small</option>
              <option value="medium">medium</option>
              <option value="large">large</option>
            </select>
          </label>
        </div>
      </div>

      {/* Group 3: YouTube Download Settings */}
      <div className="settings-group">
        <h3 className="settings-group-title">{props.t('settings.group.youtube')}</h3>
        <div className="settings-group-content grid two-col">
          <label>
            {props.t('settings.youtubeDownloadAuth')}
            <select
              value={settings.ytDlpAuthMode}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  ytDlpAuthMode: event.target.value as AppSettings['ytDlpAuthMode'],
                }))
              }
            >
              <option value="none">{props.t('settings.auth.none')}</option>
              <option value="browser_cookies">{props.t('settings.auth.browserCookies')}</option>
              <option value="cookies_file">{props.t('settings.auth.cookiesFile')}</option>
            </select>
          </label>

          {settings.ytDlpAuthMode === 'browser_cookies' && (
            <label>
              {props.t('settings.cookiesBrowser')}
              <select
                value={settings.ytDlpCookiesBrowser}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    ytDlpCookiesBrowser: event.target.value as AppSettings['ytDlpCookiesBrowser'],
                  }))
                }
              >
                <option value="chrome">chrome</option>
                <option value="chromium">chromium</option>
                <option value="edge">edge</option>
                <option value="firefox">firefox</option>
                <option value="safari">safari</option>
                <option value="brave">brave</option>
              </select>
            </label>
          )}

          {settings.ytDlpAuthMode === 'cookies_file' && (
            <label className="full">
              {props.t('settings.cookiesFilePath')}
              <input
                type="text"
                value={settings.ytDlpCookiesFilePath}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    ytDlpCookiesFilePath: event.target.value,
                  }))
                }
                placeholder="/path/to/youtube-cookies.txt"
              />
            </label>
          )}
        </div>
      </div>

      {/* Group 4: Transcription Settings */}
      <div className="settings-group">
        <h3 className="settings-group-title">{props.t('settings.group.transcription')}</h3>
        <div className="settings-group-content grid two-col">
          <label>
            {props.t('settings.whisperModel')}
            <select
              value={settings.defaultWhisperModel}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  defaultWhisperModel: event.target.value as AppSettings['defaultWhisperModel'],
                }))
              }
            >
              <option value="tiny">tiny</option>
              <option value="base">base</option>
              <option value="small">small</option>
              <option value="medium">medium</option>
              <option value="large">large</option>
            </select>
          </label>
        </div>
      </div>

      {/* Group 5: Advanced Options */}
      <details className="settings-advanced">
        <summary>{props.t('settings.advanced')}</summary>
        <div className="grid two-col settings-advanced-grid">
          <label>
            {props.t('settings.translateTemperature')}
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={settings.translateTemperature}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  translateTemperature: Number(event.target.value) || 0,
                }))
              }
            />
          </label>

          <label>
            {props.t('settings.stageTimeoutMs')}
            <input
              type="number"
              min="1000"
              step="1000"
              value={settings.stageTimeoutMs}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  stageTimeoutMs: Number(event.target.value) || props.model.defaultStageTimeoutMs,
                }))
              }
            />
          </label>

          <label>
            {props.t('settings.retryDownload')}
            <input
              type="number"
              min="0"
              step="1"
              value={settings.retryPolicy.download}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  retryPolicy: {
                    ...prev.retryPolicy,
                    download: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                  },
                }))
              }
            />
          </label>

          <label>
            {props.t('settings.retryTranslate')}
            <input
              type="number"
              min="0"
              step="1"
              value={settings.retryPolicy.translate}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  retryPolicy: {
                    ...prev.retryPolicy,
                    translate: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                  },
                }))
              }
            />
          </label>

          <label>
            {props.t('settings.retryTts')}
            <input
              type="number"
              min="0"
              step="1"
              value={settings.retryPolicy.tts}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  retryPolicy: {
                    ...prev.retryPolicy,
                    tts: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                  },
                }))
              }
            />
          </label>

          <label>
            {props.t('settings.retryTranscribe')}
            <input
              type="number"
              min="0"
              step="1"
              value={settings.retryPolicy.transcribe}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  retryPolicy: {
                    ...prev.retryPolicy,
                    transcribe: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                  },
                }))
              }
            />
          </label>
        </div>
      </details>

      <p className="hint">{props.t('settings.securityNote')}</p>
      <p className="hint">{props.t('settings.paramRanges')}</p>

      <div className="actions">
        <button
          className="btn primary"
          onClick={() => void props.actions.onSave()}
          disabled={props.model.settingsSaving}
        >
          {props.model.settingsSaving ? props.t('settings.saving') : props.t('settings.save')}
        </button>
      </div>

      {/* Toast 通知 */}
      <Toast
        message={props.t('settings.saveSuccess')}
        visible={props.model.settingsSaveSuccess}
        onClose={props.actions.clearSaveSuccess}
        type="success"
      />
      <Toast
        message={props.model.settingsSaveErrorMessage || props.t('settings.saveFailed')}
        visible={props.model.settingsSaveError}
        onClose={props.actions.clearSaveError}
        type="error"
      />
    </section>
  )
}
