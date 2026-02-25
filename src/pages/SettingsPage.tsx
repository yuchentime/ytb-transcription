import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings, TranslateProvider, TtsProvider } from '../../electron/core/db/types'
import type { TranslateConnectivityResult } from '../../electron/ipc/channels'
import type { TranslateFn } from '../app/i18n'
import { VoicePresetPanel } from '../components/VoicePresetPanel'
import { Toast } from '../components/Toast'
import { TRANSLATE_MODEL_OPTIONS, TTS_MODEL_OPTIONS } from '../app/utils'
import {
  DEFAULT_BASE_URLS,
  DEFAULT_CUSTOM_BASE_URL,
  QWEN_REGION_PROVIDER_OPTIONS,
  TRANSLATE_PROVIDERS,
  TTS_PROVIDERS,
} from '../app/constants'

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
  onTestTranslateConnectivity(settings: AppSettings): Promise<TranslateConnectivityResult>
  clearSaveSuccess(): void
  clearSaveError(): void
}

interface SettingsPageProps {
  model: SettingsPageModel
  actions: SettingsPageActions
  t: TranslateFn
}

type CloudTtsProvider = Exclude<TtsProvider, 'piper'>
type QwenRegionSelectValue = (typeof QWEN_REGION_PROVIDER_OPTIONS)[number]['value']
type TtsProviderSelectValue = CloudTtsProvider | QwenRegionSelectValue

const OPENAI_TTS_VOICE_PROFILES: SettingsPageModel['voiceProfiles'] = [
  {
    id: 'alloy',
    displayName: 'Alloy (OpenAI)',
    description: 'Neutral and balanced',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'ash',
    displayName: 'Ash (OpenAI)',
    description: 'Deep and steady',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'coral',
    displayName: 'Coral (OpenAI)',
    description: 'Warm and clear',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'echo',
    displayName: 'Echo (OpenAI)',
    description: 'Bright and energetic',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'sage',
    displayName: 'Sage (OpenAI)',
    description: 'Calm and mature',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'shimmer',
    displayName: 'Shimmer (OpenAI)',
    description: 'Soft and friendly',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
]

const GLM_TTS_VOICE_PROFILES: SettingsPageModel['voiceProfiles'] = [
  {
    id: 'tongtong',
    displayName: 'Tongtong (GLM)',
    description: 'Female child',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'chuichui',
    displayName: 'Chuichui (GLM)',
    description: 'Male voice',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'xiaochen',
    displayName: 'Xiaochen (GLM)',
    description: 'Male voice',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'jam',
    displayName: 'Jam (GLM)',
    description: 'Male voice',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'kazi',
    displayName: 'Kazi (GLM)',
    description: 'Male voice',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'douji',
    displayName: 'Douji (GLM)',
    description: 'Female voice',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'luodo',
    displayName: 'Luodo (GLM)',
    description: 'Neutral voice',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
]

const QWEN_TTS_VOICE_PROFILES: SettingsPageModel['voiceProfiles'] = [
  {
    id: 'Cherry',
    displayName: 'Cherry (Qwen)',
    description: 'Warm and neutral',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'Chelsie',
    displayName: 'Chelsie (Qwen)',
    description: 'Bright and youthful',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'Ethan',
    displayName: 'Ethan (Qwen)',
    description: 'Stable male voice',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'Serena',
    displayName: 'Serena (Qwen)',
    description: 'Soft and clear',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'Dylan',
    displayName: 'Dylan (Qwen)',
    description: 'Calm male tone',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'Jada',
    displayName: 'Jada (Qwen)',
    description: 'Clear female tone',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
  {
    id: 'Sunny',
    displayName: 'Sunny (Qwen)',
    description: 'Energetic and lively',
    language: 'multi',
    speedRange: [0.5, 2],
    pitchRange: [-10, 10],
    volumeRange: [0, 10],
  },
]

const NON_MINIMAX_CLOUD_VOICE_IDS = new Set(
  [...OPENAI_TTS_VOICE_PROFILES, ...GLM_TTS_VOICE_PROFILES, ...QWEN_TTS_VOICE_PROFILES].map(
    (voice) => voice.id,
  ),
)

function filterVoicesByLanguage(
  voices: SettingsPageModel['voiceProfiles'],
  targetLanguage: AppSettings['ttsTargetLanguage'],
): SettingsPageModel['voiceProfiles'] {
  return voices.filter((voice) => voice.language === targetLanguage || voice.language === 'multi')
}

function getVoiceProfilesForProvider(
  provider: CloudTtsProvider,
  voices: SettingsPageModel['voiceProfiles'],
  targetLanguage: AppSettings['ttsTargetLanguage'],
): SettingsPageModel['voiceProfiles'] {
  const providerVoices = (() => {
    switch (provider) {
      case 'openai':
        return OPENAI_TTS_VOICE_PROFILES
      case 'glm':
        return GLM_TTS_VOICE_PROFILES
      case 'qwen':
        return QWEN_TTS_VOICE_PROFILES
      case 'minimax':
        return voices.filter((voice) => !NON_MINIMAX_CLOUD_VOICE_IDS.has(voice.id))
    }
  })()
  return filterVoicesByLanguage(providerVoices, targetLanguage)
}

function normalizeTtsProvider(provider: TtsProvider): CloudTtsProvider {
  return provider === 'piper' ? 'minimax' : provider
}

function normalizeUrlForCompare(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

function isQwenRegionSelectValue(value: TtsProviderSelectValue): value is QwenRegionSelectValue {
  return QWEN_REGION_PROVIDER_OPTIONS.some((option) => option.value === value)
}

function resolveCloudTtsProviderFromSelect(value: TtsProviderSelectValue): CloudTtsProvider {
  if (isQwenRegionSelectValue(value)) {
    return 'qwen'
  }
  return value
}

function resolveQwenBaseUrlFromSelect(value: TtsProviderSelectValue): string | null {
  const matched = QWEN_REGION_PROVIDER_OPTIONS.find((option) => option.value === value)
  return matched?.baseUrl ?? null
}

function resolveTtsProviderSelectValue(settings: AppSettings): TtsProviderSelectValue {
  const provider = normalizeTtsProvider(settings.ttsProvider)
  if (provider !== 'qwen') {
    return provider
  }
  const normalizedCurrentBaseUrl = normalizeUrlForCompare(settings.qwenApiBaseUrl || '')
  const matched = QWEN_REGION_PROVIDER_OPTIONS.find(
    (option) => normalizeUrlForCompare(option.baseUrl) === normalizedCurrentBaseUrl,
  )
  return matched?.value ?? QWEN_REGION_PROVIDER_OPTIONS[0].value
}

export function SettingsPage(props: SettingsPageProps) {
  const { settings } = props.model
  const { setSettings } = props.actions
  const currentTtsProviderSelectValue = resolveTtsProviderSelectValue(settings)
  const currentTtsProvider = resolveCloudTtsProviderFromSelect(currentTtsProviderSelectValue)
  const availableVoiceProfiles = getVoiceProfilesForProvider(
    currentTtsProvider,
    props.model.voiceProfiles,
    settings.ttsTargetLanguage,
  )
  const [translateTestLoading, setTranslateTestLoading] = useState(false)
  const [translateTestStatus, setTranslateTestStatus] = useState<'idle' | 'success' | 'error'>('idle')

  useEffect(() => {
    setTranslateTestStatus('idle')
  }, [
    settings.translateProvider,
    settings.translateModelId,
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

  const getTtsModels = (provider: CloudTtsProvider): string[] => {
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
      case 'openai':
        return 'openaiApiKey'
      case 'qwen':
        return 'qwenApiKey'
      case 'kimi':
        return 'kimiApiKey'
      case 'custom':
        // For custom/local providers, use a generic custom API key field
        return 'customApiKey' as keyof AppSettings
      default:
        return 'minimaxApiKey'
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
      case 'openai':
        return 'openaiApiBaseUrl'
      case 'qwen':
        return 'qwenApiBaseUrl'
      case 'kimi':
        return 'kimiApiBaseUrl'
      case 'custom':
        // For custom/local providers, use a generic custom base URL field
        return 'customApiBaseUrl' as keyof AppSettings
      default:
        return 'minimaxApiBaseUrl'
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
                  {props.t(p.labelKey)}
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
                  : `${DEFAULT_CUSTOM_BASE_URL} (OpenAI-compatible)`
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
              value={currentTtsProviderSelectValue}
              onChange={(event) => {
                const selectedValue = event.target.value as TtsProviderSelectValue
                const newProvider = resolveCloudTtsProviderFromSelect(selectedValue)
                const selectedQwenBaseUrl = resolveQwenBaseUrlFromSelect(selectedValue)
                const availableModels = getTtsModels(newProvider)
                const currentModelValid = availableModels.includes(settings.ttsModelId)
                setSettings((prev) => {
                  const baseUrlField = getBaseUrlField(newProvider)
                  const defaultBaseUrl = DEFAULT_BASE_URLS[newProvider]
                  const filteredVoices = getVoiceProfilesForProvider(
                    newProvider,
                    props.model.voiceProfiles,
                    prev.ttsTargetLanguage,
                  )
                  const currentVoiceValid = filteredVoices.some((voice) => voice.id === prev.ttsVoiceId)
                  const resolvedQwenBaseUrl =
                    newProvider === 'qwen'
                      ? selectedQwenBaseUrl || prev.qwenApiBaseUrl || DEFAULT_BASE_URLS.qwen
                      : prev.qwenApiBaseUrl
                  return {
                    ...prev,
                    ttsProvider: newProvider,
                    // Auto-select first available model if current model is not valid for new provider
                    ttsModelId: currentModelValid ? prev.ttsModelId : (availableModels[0] ?? ''),
                    // Auto-select first compatible voice when provider changes
                    ttsVoiceId: currentVoiceValid ? prev.ttsVoiceId : (filteredVoices[0]?.id ?? ''),
                    // Auto-set default base URL if empty
                    [baseUrlField]:
                      newProvider === 'qwen'
                        ? resolvedQwenBaseUrl
                        : (prev[baseUrlField] as string) || defaultBaseUrl,
                    qwenApiBaseUrl: resolvedQwenBaseUrl,
                  }
                })
              }}
            >
              {TTS_PROVIDERS.filter((provider) => provider.value !== 'qwen').map((p) => (
                <option key={p.value} value={p.value}>
                  {props.t(p.labelKey)}
                </option>
              ))}
              {QWEN_REGION_PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {props.t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>

          {/* TTS Provider API Key */}
          <label>
            {props.t('settings.ttsApiKey', { provider: currentTtsProvider.toUpperCase() })}
            <input
              type="password"
              value={settings[getApiKeyField(currentTtsProvider)] as string}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  [getApiKeyField(currentTtsProvider)]: event.target.value,
                }))
              }
              placeholder="sk-..."
            />
          </label>

          {/* TTS Provider Base URL */}
          <label>
            {props.t('settings.ttsBaseUrl', { provider: currentTtsProvider.toUpperCase() })}
            <input
              type="text"
              value={settings[getBaseUrlField(currentTtsProvider)] as string}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  [getBaseUrlField(currentTtsProvider)]: event.target.value.trim(),
                  ...(currentTtsProvider === 'qwen'
                    ? { qwenApiBaseUrl: event.target.value.trim() }
                    : {}),
                }))
              }
              placeholder={DEFAULT_BASE_URLS[currentTtsProvider]}
            />
            {currentTtsProvider === 'qwen' && <small className="hint">{props.t('settings.qwenRegionHint')}</small>}
          </label>

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
              {getTtsModels(currentTtsProvider).map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>

          {/* TTS Target Language - controls voice preset filtering */}
          <label>
            {props.t('settings.ttsTargetLanguage')}
            <select
              value={settings.ttsTargetLanguage}
              onChange={(event) => {
                const newTargetLanguage = event.target.value as 'zh' | 'en'
                setSettings((prev) => {
                  const filteredVoices = getVoiceProfilesForProvider(
                    normalizeTtsProvider(prev.ttsProvider),
                    props.model.voiceProfiles,
                    newTargetLanguage,
                  )
                  const currentVoiceValid = filteredVoices.some((voice) => voice.id === prev.ttsVoiceId)
                  return {
                    ...prev,
                    ttsTargetLanguage: newTargetLanguage,
                    ttsVoiceId: currentVoiceValid ? prev.ttsVoiceId : (filteredVoices[0]?.id ?? ''),
                  }
                })
              }}
            >
              <option value="zh">{props.t('lang.zh')}</option>
              <option value="en">English</option>
            </select>
          </label>

          {/* Voice Preset Panel */}
          <div>
            <VoicePresetPanel
              voiceId={settings.ttsVoiceId}
              speed={settings.ttsSpeed}
              pitch={settings.ttsPitch}
              volume={settings.ttsVolume}
              voiceProfiles={availableVoiceProfiles}
              validationErrors={currentTtsProvider === 'minimax' ? props.model.voiceValidationErrors : []}
              showAdvancedParams={false}
              t={props.t}
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
            <span className="settings-label-with-tip">
              {props.t('settings.youtubeDownloadAuth')}
              <span
                className="settings-tip-icon"
                data-tooltip={props.t('settings.youtubeDownloadAuthHint')}
                aria-label={props.t('settings.youtubeDownloadAuthHintAria')}
                role="img"
                tabIndex={0}
              >
                ?
              </span>
            </span>
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

      <p className="hint">{props.t('settings.securityNote')}</p>

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
