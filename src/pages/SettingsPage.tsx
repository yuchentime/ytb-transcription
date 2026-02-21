import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings } from '../../electron/core/db/types'

interface SettingsPageModel {
  settings: AppSettings
  settingsLoading: boolean
  settingsSaving: boolean
  settingsError: string
  defaultStageTimeoutMs: number
}

interface SettingsPageActions {
  setSettings: Dispatch<SetStateAction<AppSettings>>
  onSave(): Promise<void>
}

interface SettingsPageProps {
  model: SettingsPageModel
  actions: SettingsPageActions
}

export function SettingsPage(props: SettingsPageProps) {
  const { settings } = props.model
  const { setSettings } = props.actions

  return (
    <section className="panel main-panel">
      <h2>Settings</h2>
      {props.model.settingsLoading && <p className="hint">Loading settings...</p>}

      <div className="grid">
        <label>
          Provider (Read-only)
          <input type="text" value={settings.provider} readOnly />
        </label>

        <label>
          YouTube Download Auth
          <select
            value={settings.ytDlpAuthMode}
            onChange={(event) =>
              setSettings((prev) => ({
                ...prev,
                ytDlpAuthMode: event.target.value as AppSettings['ytDlpAuthMode'],
              }))
            }
          >
            <option value="none">None</option>
            <option value="browser_cookies">Browser Cookies</option>
            <option value="cookies_file">Cookies File</option>
          </select>
        </label>

        {settings.ytDlpAuthMode === 'browser_cookies' && (
          <label>
            Cookies Browser
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
            Cookies File Path
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

        <label>
          Whisper Model
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

        <label>
          MiniMax API Key
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
          MiniMax Base URL
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
          Translate Model ID
          <input
            type="text"
            value={settings.translateModelId}
            onChange={(event) =>
              setSettings((prev) => ({
                ...prev,
                translateModelId: event.target.value,
              }))
            }
          />
        </label>

        <label>
          Translate Temperature
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
          TTS Model ID
          <input
            type="text"
            value={settings.ttsModelId}
            onChange={(event) =>
              setSettings((prev) => ({
                ...prev,
                ttsModelId: event.target.value,
              }))
            }
          />
        </label>

        <label>
          TTS Voice ID
          <input
            type="text"
            value={settings.ttsVoiceId}
            onChange={(event) =>
              setSettings((prev) => ({
                ...prev,
                ttsVoiceId: event.target.value,
              }))
            }
          />
        </label>

        <label>
          TTS Speed
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
          TTS Pitch
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
          TTS Volume
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
          Default Target Language
          <select
            value={settings.defaultTargetLanguage}
            onChange={(event) =>
              setSettings((prev) => ({
                ...prev,
                defaultTargetLanguage: event.target.value as 'zh' | 'en' | 'ja',
              }))
            }
          >
            <option value="zh">zh</option>
            <option value="en">en</option>
            <option value="ja">ja</option>
          </select>
        </label>

        <label>
          Stage Timeout (ms)
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
          Retry: Download
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
          Retry: Translate
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
          Retry: TTS
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
          Retry: Transcribe
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

      <p className="hint">
        Security note: translation and TTS will send text content to MiniMax cloud APIs.
      </p>

      <div className="actions">
        <button
          className="btn primary"
          onClick={() => void props.actions.onSave()}
          disabled={props.model.settingsSaving}
        >
          {props.model.settingsSaving ? 'Saving...' : 'Save Settings'}
        </button>
        {props.model.settingsError && <span className="error">{props.model.settingsError}</span>}
      </div>
    </section>
  )
}
