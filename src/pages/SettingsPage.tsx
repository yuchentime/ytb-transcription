import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings, TranslateProvider, TtsProvider } from '../../electron/core/db/types'
import type {
  PiperInstallResult,
  PiperProbeResult,
  TranslateConnectivityResult,
} from '../../electron/ipc/channels'
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
  { value: 'custom', label: '自定义(OpenAI-compatible)' },
] 

// TTS provider options
const TTS_PROVIDERS: { value: TtsProvider; label: string }[] = [
  { value: 'minimax', label: 'MiniMax' },
  { value: 'piper', label: '本地语音合成（Piper）' },
]

// Default base URLs for providers
const DEFAULT_BASE_URLS = {
  minimax: 'https://api.minimaxi.com',
  deepseek: 'https://api.deepseek.com',
  glm: 'https://open.bigmodel.cn/api/paas',
  kimi: 'https://api.moonshot.cn',
} as const

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
  onProbePiper(settings: AppSettings): Promise<PiperProbeResult>
  onInstallPiper(settings: AppSettings, forceReinstall?: boolean): Promise<PiperInstallResult>
  onTestTranslateConnectivity(settings: AppSettings): Promise<TranslateConnectivityResult>
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
  const [probeLoading, setProbeLoading] = useState(false)
  const [probeResult, setProbeResult] = useState<PiperProbeResult | null>(null)
  const [probeError, setProbeError] = useState('')
  const [installLoading, setInstallLoading] = useState(false)
  const [installResult, setInstallResult] = useState<PiperInstallResult | null>(null)
  const [installError, setInstallError] = useState('')
  const [installSuccessToastVisible, setInstallSuccessToastVisible] = useState(false)
  const [installErrorToastVisible, setInstallErrorToastVisible] = useState(false)
  const [translateTestLoading, setTranslateTestLoading] = useState(false)
  const [translateTestStatus, setTranslateTestStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const isPiperInstalled = Boolean(settings.piperModelPath.trim()) || probeResult?.ok === true || installResult !== null

  useEffect(() => {
    setTranslateTestStatus('idle')
  }, [
    settings.translateProvider,
    settings.translateModelId,
    settings.translateTemperature,
    settings.minimaxApiKey,
    settings.minimaxApiBaseUrl,
    settings.deepseekApiKey,
    settings.deepseekApiBaseUrl,
    settings.glmApiKey,
    settings.glmApiBaseUrl,
    settings.kimiApiKey,
    settings.kimiApiBaseUrl,
    settings.customApiKey,
    settings.customApiBaseUrl,
  ])

  // Helper to get available models for a provider
  const getTranslateModels = (provider: TranslateProvider): string[] => {
    if (provider === 'custom') return []
    return TRANSLATE_MODEL_OPTIONS[provider] ?? []
  }

  const getTtsModels = (provider: TtsProvider): string[] => {
    if (provider === 'piper') return []
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
      case 'piper':
        // Piper does not use API key, keep return type complete for shared helper.
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
      case 'piper':
        // Piper does not use base URL, keep return type complete for shared helper.
        return 'customApiBaseUrl' as keyof AppSettings
    }
  }

  async function handleProbePiper(): Promise<void> {
    setProbeLoading(true)
    setProbeError('')
    try {
      const result = await props.actions.onProbePiper(settings)
      setProbeResult(result)
    } catch (error) {
      setProbeResult(null)
      setProbeError(error instanceof Error ? error.message : String(error))
    } finally {
      setProbeLoading(false)
    }
  }

  async function handleInstallPiper(forceReinstall = false): Promise<void> {
    setInstallLoading(true)
    setInstallError('')
    setInstallSuccessToastVisible(false)
    setInstallErrorToastVisible(false)
    try {
      const result = await props.actions.onInstallPiper(settings, forceReinstall)
      setInstallResult(result)
      const nextSettings: AppSettings = {
        ...settings,
        piperExecutablePath: result.piperExecutablePath,
        piperModelPath: result.piperModelPath,
        piperConfigPath: result.piperConfigPath,
      }
      setSettings((prev) => ({
        ...prev,
        piperExecutablePath: result.piperExecutablePath,
        piperModelPath: result.piperModelPath,
        piperConfigPath: result.piperConfigPath,
      }))
      const probe = await props.actions.onProbePiper(nextSettings)
      setProbeResult(probe)
      setProbeError('')
      setInstallSuccessToastVisible(true)
    } catch (error) {
      setInstallResult(null)
      setInstallError(error instanceof Error ? error.message : String(error))
      setInstallErrorToastVisible(true)
    } finally {
      setInstallLoading(false)
    }
  }

  async function handleTestTranslateConnectivity(): Promise<void> {
    setTranslateTestLoading(true)
    setTranslateTestStatus('idle')
    try {
      const result = await props.actions.onTestTranslateConnectivity(settings)
      setTranslateTestStatus(result.ok ? 'success' : 'error')
    } catch {
      setTranslateTestStatus('error')
    } finally {
      setTranslateTestLoading(false)
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

          <div className="full">
            <div className="actions settings-connectivity-actions">
              <button
                className="btn primary"
                type="button"
                onClick={() => void handleTestTranslateConnectivity()}
                disabled={translateTestLoading}
              >
                {translateTestLoading
                  ? props.t('settings.translateConnectivityTesting')
                  : props.t('settings.translateConnectivityTest')}
              </button>
              {translateTestStatus === 'success' && (
                <span className="settings-connectivity-status success">
                  {props.t('settings.translateConnectivityPass')}
                </span>
              )}
              {translateTestStatus === 'error' && (
                <span className="settings-connectivity-status error">
                  {props.t('settings.translateConnectivityFail')}
                </span>
              )}
            </div>
          </div>
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
                  if (newProvider === 'piper') {
                    return {
                      ...prev,
                      ttsProvider: newProvider,
                      ttsModelId: '',
                    }
                  }
                  const baseUrlField = getBaseUrlField(newProvider)
                  const defaultBaseUrl = DEFAULT_BASE_URLS[newProvider]
                  return {
                    ...prev,
                    ttsProvider: newProvider,
                    // Auto-select first available model if current model is not valid for new provider
                    ttsModelId: currentModelValid ? prev.ttsModelId : (availableModels[0] ?? ''),
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

          {settings.ttsProvider !== 'piper' && (
            <>
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
                  placeholder={DEFAULT_BASE_URLS[settings.ttsProvider]}
                />
              </label>
            </>
          )}

          {settings.ttsProvider !== 'piper' && (
            <label>
              {props.t('settings.ttsModelId')}
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
            </label>
          )}

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
          {settings.ttsProvider !== 'piper' && (
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
          )}
          {settings.ttsProvider === 'piper' && (
            <div className="full">
              <p className="hint">Piper 使用本地模型，不依赖云端 API Key/Base URL。</p>
              <p className="hint">首次使用可一键安装 Piper 运行环境与默认音色模型（自动下载）。</p>
              <div className="actions">
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => void handleInstallPiper(isPiperInstalled)}
                  disabled={installLoading}
                >
                  {installLoading ? '安装中...' : isPiperInstalled ? '重新安装Piper' : '一键安装Piper'}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void handleProbePiper()}
                  disabled={probeLoading}
                >
                  {probeLoading ? '检测中...' : '检测 Piper 就绪状态'}
                </button>
                {probeResult?.ok && <span className="settings-connectivity-status success">检测通过✅</span>}
                {(probeError || (probeResult && !probeResult.ok)) && (
                  <span className="settings-connectivity-status error">检测失败，请检查配置</span>
                )}
              </div>
              {installError && <p className="error">{installError}</p>}
              {installResult && (
                <div className="hint">
                  <p>{installResult.summary}</p>
                  <p>Release: {installResult.releaseTag}</p>
                  <p>Voice: {installResult.voice}</p>
                </div>
              )}
            </div>
          )}
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
      <Toast
        message={props.t('settings.piperInstallSuccess')}
        visible={installSuccessToastVisible}
        onClose={() => setInstallSuccessToastVisible(false)}
        duration={3000}
        type="success"
      />
      <Toast
        message={props.t('settings.piperInstallFailed')}
        visible={installErrorToastVisible}
        onClose={() => setInstallErrorToastVisible(false)}
        duration={3000}
        type="error"
      />
    </section>
  )
}
