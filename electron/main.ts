import { app, BrowserWindow, nativeImage, ipcMain, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { closeDatabase, initDatabase } from './core/db'
import { initTaskEngine } from './core/task-engine'
import { registerIpcHandlers } from './ipc/handlers'
import { IPC_CHANNELS, type UpdateStatusPayload } from './ipc/channels'
import { autoUpdater } from 'electron-updater'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTO_UPDATE_URL = 'https://www.xhsnotes.top/auto-update-ytb'

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')
const APP_ROOT = process.env.APP_ROOT

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let isStartupUpdateCheck = false
let isUpdateDownloadInProgress = false
let ignoredVersion: string | null = null

// 忽略版本记录文件路径
function getIgnoredVersionPath(): string {
  return path.join(app.getPath('userData'), 'ignored-update-version.json')
}

// 加载忽略的版本
function loadIgnoredVersion(): void {
  try {
    const filePath = getIgnoredVersionPath()
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      ignoredVersion = data.version || null
    }
  } catch (error) {
    console.error('[AutoUpdater] Failed to load ignored version:', error)
  }
}

// 保存忽略的版本
function saveIgnoredVersion(version: string | null): void {
  try {
    const filePath = getIgnoredVersionPath()
    if (version) {
      fs.writeFileSync(filePath, JSON.stringify({ version, ignoredAt: new Date().toISOString() }))
    } else {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    }
    ignoredVersion = version
  } catch (error) {
    console.error('[AutoUpdater] Failed to save ignored version:', error)
  }
}

function createWindow() {
  const publicRoot = process.env.VITE_PUBLIC ?? path.join(APP_ROOT, 'public')

  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(publicRoot, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    // win.webContents.openDevTools({ mode: 'detach' })
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('before-quit', () => {
  closeDatabase()
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  // Set dock icon only in development; in production use the bundled app icon (icns).
  if (process.platform === 'darwin' && VITE_DEV_SERVER_URL) {
    const publicRoot = process.env.VITE_PUBLIC ?? path.join(APP_ROOT, 'public')
    const dockIcon = nativeImage.createFromPath(path.join(publicRoot, 'logo.png'))
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon)
    }
  }

  try {
    const dbContext = initDatabase()
    initTaskEngine(dbContext)
    registerIpcHandlers()
    initAutoUpdater()
  } catch (error) {
    console.error('Failed to initialize database:', error)
    app.quit()
    return
  }

  createWindow()
})

// Auto-updater configuration
function initAutoUpdater() {
  registerUpdateIpcHandlers()

  // Only enable auto-updater in production
  if (VITE_DEV_SERVER_URL) {
    console.log('[AutoUpdater] Skipping auto-updater in development mode')
    return
  }

  // 加载已忽略的版本
  loadIgnoredVersion()

  // Configure auto-updater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: AUTO_UPDATE_URL,
  })
  console.log(`[AutoUpdater] Feed URL: ${AUTO_UPDATE_URL}`)

  // Event handlers
  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...')
    sendUpdateStatus('checking')
  })

  autoUpdater.on('update-available', (info) => {
    const releaseNotes = Array.isArray(info.releaseNotes)
      ? info.releaseNotes
          .map((note) =>
            note && typeof note === 'object' && 'note' in note && typeof note.note === 'string'
              ? note.note
              : '',
          )
          .filter((note) => Boolean(note))
          .join('\n\n') || undefined
      : typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : undefined

    console.log('[AutoUpdater] Update available:', info.version)
    
    // 检查是否被用户忽略
    if (ignoredVersion === info.version && isStartupUpdateCheck) {
      console.log('[AutoUpdater] Version ignored by user:', info.version)
      sendUpdateStatus('not-available')
      return
    }

    sendUpdateStatus('available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes,
      isStartup: isStartupUpdateCheck,
    })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] No update available')
    sendUpdateStatus('not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[AutoUpdater] Download progress: ${progress.percent.toFixed(1)}%`)
    sendUpdateStatus('downloading', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info.version)
    sendUpdateStatus('downloaded', {
      version: info.version,
    })
    // 显示重启确认对话框
    showRestartDialog(info.version)
  })

  autoUpdater.on('error', (error) => {
    console.error('[AutoUpdater] Error:', error.message)
    sendUpdateStatus('error', {
      message: error.message
    })
  })

  // Check for updates on startup (with a delay to not block app launch)
  setTimeout(() => {
    void checkForUpdatesOnStartup()
  }, 3000)
}

async function checkForUpdatesOnStartup(): Promise<void> {
  if (VITE_DEV_SERVER_URL) return
  isStartupUpdateCheck = true
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    console.error('[AutoUpdater] Initial check failed:', err)
  } finally {
    isStartupUpdateCheck = false
  }
}

async function downloadUpdateWithGuard(): Promise<boolean> {
  if (VITE_DEV_SERVER_URL) {
    sendUpdateStatus('not-available', {
      message: 'Auto-updater is disabled in development mode',
    })
    return false
  }

  if (isUpdateDownloadInProgress) {
    return true
  }

  isUpdateDownloadInProgress = true

  try {
    await autoUpdater.downloadUpdate()
    return true
  } catch (error) {
    console.error('[AutoUpdater] Download update failed:', error)
    sendUpdateStatus('error', {
      message: error instanceof Error ? error.message : String(error),
    })
    return false
  } finally {
    isUpdateDownloadInProgress = false
  }
}

// 显示重启确认对话框（在主进程中使用原生对话框）
async function showRestartDialog(version: string): Promise<void> {
  if (!win || win.isDestroyed()) return
  
  const result = await dialog.showMessageBox(win, {
    type: 'info',
    title: '更新已下载',
    message: `新版本 ${version} 已准备就绪`,
    detail: '是否立即重启应用以完成更新？\n\n点击"稍后"将在退出应用时自动安装更新。',
    buttons: ['立即重启', '稍后'],
    defaultId: 0,
    cancelId: 1,
  })

  if (result.response === 0) {
    console.log('[AutoUpdater] User chose to restart and install')
    autoUpdater.quitAndInstall(false, true)
  } else {
    console.log('[AutoUpdater] User chose to install later')
    // 启用退出时自动安装
    autoUpdater.autoInstallOnAppQuit = true
  }
}

function registerUpdateIpcHandlers() {
  ipcMain.removeHandler(IPC_CHANNELS.updateCheck)
  ipcMain.removeHandler(IPC_CHANNELS.updateDownload)
  ipcMain.removeHandler(IPC_CHANNELS.updateInstall)
  ipcMain.removeHandler(IPC_CHANNELS.updateGetVersion)
  ipcMain.removeHandler(IPC_CHANNELS.updateIgnoreVersion)
  ipcMain.removeHandler(IPC_CHANNELS.updateLater)

  ipcMain.handle(IPC_CHANNELS.updateCheck, async () => {
    if (VITE_DEV_SERVER_URL) {
      sendUpdateStatus('not-available', {
        message: 'Auto-updater is disabled in development mode',
      })
      return null
    }

    try {
      return await autoUpdater.checkForUpdates()
    } catch (error) {
      console.error('[AutoUpdater] Check for updates failed:', error)
      sendUpdateStatus('error', {
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.updateDownload, async () => {
    return await downloadUpdateWithGuard()
  })

  ipcMain.handle(IPC_CHANNELS.updateInstall, () => {
    if (VITE_DEV_SERVER_URL) {
      return
    }
    autoUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle(IPC_CHANNELS.updateGetVersion, () => {
    return app.getVersion()
  })

  // 忽略此版本
  ipcMain.handle(IPC_CHANNELS.updateIgnoreVersion, (_, version: string) => {
    saveIgnoredVersion(version)
    console.log('[AutoUpdater] Version ignored:', version)
  })

  // 稍后提醒（清除待更新状态）
  ipcMain.handle(IPC_CHANNELS.updateLater, () => {
    sendUpdateStatus('idle')
  })
}

function sendUpdateStatus(
  status: UpdateStatusPayload['status'],
  data?: UpdateStatusPayload['data'],
) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.updateStatus, { status, data })
  }
}
