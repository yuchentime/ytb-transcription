import type { Dispatch, SetStateAction } from 'react'
import type { VoiceProfile } from '../../electron/core/db/types'
import type { TranslateFn } from '../app/i18n'

interface VoicePresetPanelProps {
  voiceId: string
  speed: number
  pitch: number
  volume: number
  voiceProfiles: VoiceProfile[]
  validationErrors: string[]
  showAdvancedParams?: boolean
  t: TranslateFn
  setVoiceConfig: Dispatch<
    SetStateAction<{
      voiceId: string
      speed: number
      pitch: number
      volume: number
    }>
  >
}

export function VoicePresetPanel(props: VoicePresetPanelProps) {
  const {
    voiceId,
    speed,
    pitch,
    volume,
    voiceProfiles,
    validationErrors,
    showAdvancedParams = true,
    t,
    setVoiceConfig,
  } = props

  return (
    <div className="voice-preset-panel">
      <label>
        {t('task.voicePreset')}
        <select
          value={voiceId}
          onChange={(event) =>
            setVoiceConfig((prev) => ({
              ...prev,
              voiceId: event.target.value,
            }))
          }
        >
          <option value="">{t('task.selectVoice')}</option>
          {voiceProfiles.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.displayName}
            </option>
          ))}
        </select>
      </label>

      {showAdvancedParams && (
        <>
          <label>
            {t('task.ttsSpeed')}
            <input
              type="number"
              min={0.5}
              max={2}
              step={0.1}
              value={speed}
              onChange={(event) =>
                setVoiceConfig((prev) => ({
                  ...prev,
                  speed: Number(event.target.value) || 1,
                }))
              }
            />
          </label>
          <label>
            {t('task.ttsPitch')}
            <input
              type="number"
              min={-10}
              max={10}
              step={0.1}
              value={pitch}
              onChange={(event) =>
                setVoiceConfig((prev) => ({
                  ...prev,
                  pitch: Number(event.target.value) || 0,
                }))
              }
            />
          </label>
          <label>
            {t('task.ttsVolume')}
            <input
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={volume}
              onChange={(event) =>
                setVoiceConfig((prev) => ({
                  ...prev,
                  volume: Number(event.target.value) || 1,
                }))
              }
            />
          </label>
        </>
      )}

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
