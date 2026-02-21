import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings, VoiceProfile } from '../../electron/core/db/types'

interface VoicePresetPanelProps {
  settings: AppSettings
  voiceProfiles: VoiceProfile[]
  validationErrors: string[]
  setSettings: Dispatch<SetStateAction<AppSettings>>
}

export function VoicePresetPanel(props: VoicePresetPanelProps) {
  const { settings, voiceProfiles, validationErrors, setSettings } = props

  return (
    <div className="voice-preset-panel">
      <label>
        音色预设
        <select
          value={settings.ttsVoiceId}
          onChange={(event) =>
            setSettings((prev) => ({
              ...prev,
              ttsVoiceId: event.target.value,
            }))
          }
        >
          <option value="">请选择音色</option>
          {voiceProfiles.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.displayName}
            </option>
          ))}
        </select>
      </label>

      {validationErrors.length > 0 && (
        <div className="error voice-validate-errors">
          {validationErrors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
    </div>
  )
}
