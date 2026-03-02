import { ipcMain } from 'electron'
import type { VoiceParamInput } from '../../core/db/types'
import { IPC_CHANNELS } from '../channels'
import { listVoiceProfiles, validateVoiceParams } from '../../services/minimax/voices'

const VOICE_PARAM_RANGE = {
  speed: [0.5, 2] as const,
  pitch: [-10, 10] as const,
  volume: [0, 10] as const,
}

function assertVoiceParamInput(input: VoiceParamInput): VoiceParamInput {
  if (!input || typeof input !== 'object') {
    throw new Error('voice params input is required')
  }

  const output: VoiceParamInput = {}
  if (input.voiceId !== undefined && input.voiceId !== null) {
    if (typeof input.voiceId !== 'string') {
      throw new Error('voiceId must be a string')
    }
    const voiceId = input.voiceId.trim()
    if (voiceId) {
      output.voiceId = voiceId
    }
  }

  const assignNumber = (key: 'speed' | 'pitch' | 'volume', value: unknown): void => {
    if (value === undefined) return
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${key} must be a finite number`)
    }
    const [min, max] = VOICE_PARAM_RANGE[key]
    if (value < min || value > max) {
      throw new Error(`${key} must be in range [${min}, ${max}]`)
    }
    output[key] = value
  }

  assignNumber('speed', input.speed)
  assignNumber('pitch', input.pitch)
  assignNumber('volume', input.volume)
  return output
}

export function registerVoicesHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.voicesList, () => {
    return listVoiceProfiles()
  })

  ipcMain.handle(IPC_CHANNELS.voicesValidateParams, (_event, input: VoiceParamInput) => {
    const normalizedInput = assertVoiceParamInput(input)
    return validateVoiceParams(normalizedInput)
  })
}
