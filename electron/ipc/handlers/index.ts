import { registerFileHandlers } from './file.handlers'
import { registerHistoryHandlers } from './history.handlers'
import { registerSettingsHandlers } from './settings.handlers'
import { registerSystemHandlers } from './system.handlers'
import { registerTaskHandlers } from './task.handlers'
import { registerTaskRecoveryHandlers } from './taskRecovery.handlers'
import { registerVoicesHandlers } from './voices.handlers'

let registered = false

export function registerIpcHandlers(): void {
  if (registered) return
  registerTaskHandlers()
  registerTaskRecoveryHandlers()
  registerHistoryHandlers()
  registerSettingsHandlers()
  registerVoicesHandlers()
  registerSystemHandlers()
  registerFileHandlers()
  registered = true
}
