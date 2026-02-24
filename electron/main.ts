import { app, BrowserWindow, nativeImage, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { closeDatabase, initDatabase } from './core/db'
import { initTaskEngine } from './core/task-engine'
import { registerIpcHandlers } from './ipc/handlers'
import { IPC_CHANNELS } from './ipc/channels'
import { autoUpdater } from 'electron-updater'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
  // Only enable auto-updater in production
  if (VITE_DEV_SERVER_URL) {
    console.log('[AutoUpdater] Skipping auto-updater in development mode')
    return
  }

  // Configure auto-updater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // Event handlers
  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...')
    sendUpdateStatus('checking')
  })

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info.version)
    sendUpdateStatus('available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes
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
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info.version)
    sendUpdateStatus('downloaded', {
      version: info.version
    })
  })

  autoUpdater.on('error', (error) => {
    console.error('[AutoUpdater] Error:', error.message)
    sendUpdateStatus('error', {
      message: error.message
    })
  })

  // IPC handlers for renderer communication
  ipcMain.handle(IPC_CHANNELS.updateCheck, async () => {
    try {
      return await autoUpdater.checkForUpdates()
    } catch (error) {
      console.error('[AutoUpdater] Check for updates failed:', error)
      return null
    }
  })

  ipcMain.handle(IPC_CHANNELS.updateDownload, async () => {
    try {
      await autoUpdater.downloadUpdate()
      return true
    } catch (error) {
      console.error('[AutoUpdater] Download update failed:', error)
      return false
    }
  })

  ipcMain.handle(IPC_CHANNELS.updateInstall, () => {
    autoUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle(IPC_CHANNELS.updateGetVersion, () => {
    return app.getVersion()
  })

  // Check for updates on startup (with a delay to not block app launch)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[AutoUpdater] Initial check failed:', err)
    })
  }, 3000)
}

function sendUpdateStatus(status: string, data?: unknown) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC_CHANNELS.updateStatus, { status, data })
  }
}
