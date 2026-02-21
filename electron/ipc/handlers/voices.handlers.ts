import { ipcMain } from 'electron'
import type { VoiceParamInput } from '../../core/db/types'
import { IPC_CHANNELS } from '../channels'
import { listVoiceProfiles, validateVoiceParams } from '../../services/minimax/voices'

function assertVoiceParamInput(input: VoiceParamInput): VoiceParamInput {
  if (!input || typeof input !== 'object') {
    throw new Error('voice params input is required')
  }

  const output: VoiceParamInput = {}
  if (input.voiceId !== undefined && input.voiceId !== null) {
    if (typeof input.voiceId !== 'string') {
      throw new Error('voiceId must be a string')
    }
    output.voiceId = input.voiceId.trim()
  }

  const assignNumber = (key: 'speed' | 'pitch' | 'volume', value: unknown): void => {
    if (value === undefined) return
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${key} must be a finite number`)
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
