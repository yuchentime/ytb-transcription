import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings } from '../../electron/core/db/types'
import type { TranslateFn } from '../app/i18n'
import { VoicePresetPanel } from '../components/VoicePresetPanel'

interface SettingsPageModel {
  settings: AppSettings
  settingsLoading: boolean
  settingsSaving: boolean
  settingsError: string
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
}

interface SettingsPageProps {
  model: SettingsPageModel
  actions: SettingsPageActions
  t: TranslateFn
}

export function SettingsPage(props: SettingsPageProps) {
  const { settings } = props.model
  const { setSettings } = props.actions

  return (
    <section className="panel main-panel settings-panel">
      <h1>{props.t('settings.title')}</h1>
      {props.model.settingsLoading && <p className="hint">{props.t('settings.loading')}</p>}

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

      {/* Group 3: MiniMax Settings */}
      <div className="settings-group">
        <h3 className="settings-group-title">{props.t('settings.group.minimax')}</h3>
        <div className="settings-group-content grid two-col">
          <label>
            {props.t('settings.providerReadonly')}
            <input type="text" value={settings.provider} readOnly />
          </label>

          <label>
            {props.t('settings.minimaxApiKey')}
            <input
              type="password"
              value={settings.minimaxApiKey}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  minimaxApiKey: event.target.value,
                }))
              }
              placeholder="sk-..."
            />
          </label>

          <label>
            {props.t('settings.minimaxBaseUrl')}
            <input
              type="text"
              value={settings.minimaxApiBaseUrl}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  minimaxApiBaseUrl: event.target.value.trim(),
                }))
              }
              placeholder="https://api.minimaxi.com"
            />
          </label>

          <label>
            {props.t('settings.translateModelId')}
            <select
              value={settings.translateModelId}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  translateModelId: event.target.value,
                }))
              }
            >
              <option value="MiniMax-M2.5">MiniMax-M2.5</option>
              <option value="MiniMax-M2.5-highspeed">MiniMax-M2.5-highspeed</option>
              <option value="MiniMax-M2.1">MiniMax-M2.1</option>
              <option value="MiniMax-M2.1-highspeed">MiniMax-M2.1-highspeed</option>
              <option value="MiniMax-M2">MiniMax-M2</option>
            </select>
          </label>
        </div>
      </div>

      {/* Group 4: TTS Settings */}
      <div className="settings-group">
        <h3 className="settings-group-title">{props.t('settings.group.tts')}</h3>
        <div className="settings-group-content grid two-col">
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
              <option value="speech-2.8-hd">speech-2.8-hd</option>
              <option value="speech-2.6-hd">speech-2.6-hd</option>
              <option value="speech-2.8-turbo">speech-2.8-turbo</option>
              <option value="speech-2.6-turbo">speech-2.6-turbo</option>
              <option value="speech-02-hd">speech-02-hd</option>
              <option value="speech-02-turbo">speech-02-turbo</option>
            </select>
          </label>

          <label>
            {props.t('settings.defaultTargetLanguage')}
            <select
              value={settings.defaultTargetLanguage}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  defaultTargetLanguage: event.target.value as 'zh-CN' | 'zh-TW',
                }))
              }
            >
              <option value="zh-CN">{props.t('lang.zhCN')}</option>
              <option value="zh-TW">{props.t('lang.zhTW')}</option>
            </select>
          </label>

          <label className="full">
            <VoicePresetPanel
              settings={settings}
              voiceProfiles={props.model.voiceProfiles}
              validationErrors={props.model.voiceValidationErrors}
              setSettings={setSettings}
            />
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
            {props.t('settings.ttsSpeed')}
            <input
              type="number"
              step="0.1"
              min="0.5"
              max="2"
              value={settings.ttsSpeed}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  ttsSpeed: Number(event.target.value) || 1,
                }))
              }
            />
          </label>

          <label>
            {props.t('settings.ttsPitch')}
            <input
              type="number"
              step="0.1"
              min="-10"
              max="10"
              value={settings.ttsPitch}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  ttsPitch: Number(event.target.value) || 0,
                }))
              }
            />
          </label>

          <label>
            {props.t('settings.ttsVolume')}
            <input
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={settings.ttsVolume}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  ttsVolume: Number(event.target.value) || 1,
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
      <p className="hint">参数范围：语速 0.5-2.0，音调 -10~10，音量 0~10。</p>

      <div className="actions">
        <button
          className="btn primary"
          onClick={() => void props.actions.onSave()}
          disabled={props.model.settingsSaving}
        >
          {props.model.settingsSaving ? props.t('settings.saving') : props.t('settings.save')}
        </button>
        {props.model.settingsError && <span className="error">{props.model.settingsError}</span>}
      </div>
    </section>
  )
}
