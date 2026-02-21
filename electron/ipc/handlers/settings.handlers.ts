import { ipcMain } from 'electron'
import { getDatabaseContext } from '../../core/db'
import { IPC_CHANNELS } from '../channels'

export function registerSettingsHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.settingsGet, () => {
    const { settingsDao } = getDatabaseContext()
    return settingsDao.getSettings()
  })

  ipcMain.handle(IPC_CHANNELS.settingsUpdate, (_event, patch) => {
    const { settingsDao } = getDatabaseContext()
    return settingsDao.upsertSettings(patch ?? {})
  })
}

