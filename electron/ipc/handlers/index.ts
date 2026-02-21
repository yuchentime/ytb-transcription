import { registerHistoryHandlers } from './history.handlers'
import { registerSettingsHandlers } from './settings.handlers'
import { registerTaskHandlers } from './task.handlers'

let registered = false

export function registerIpcHandlers(): void {
  if (registered) return
  registerTaskHandlers()
  registerHistoryHandlers()
  registerSettingsHandlers()
  registered = true
}

