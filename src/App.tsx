import { useEffect, useMemo, useState } from 'react'
import type { AppSettings, TaskStatus } from '../electron/core/db/types'
import { ipcClient } from './services/ipcClient'
import './App.css'

interface TaskFormState {
  youtubeUrl: string
  targetLanguage: 'zh' | 'en' | 'ja'
}

interface TaskOutput {
  ttsPath?: string
  transcriptPath?: string
  translationPath?: string
}

interface LogItem {
  id: number
  time: string
  stage: string
  level: 'info' | 'warn' | 'error'
  text: string
}

const STAGES = ['downloading', 'extracting', 'transcribing', 'translating', 'synthesizing', 'merging'] as const

const DEFAULT_SETTINGS: AppSettings = {
  provider: 'minimax',
  ytDlpAuthMode: 'none',
  ytDlpCookiesBrowser: 'chrome',
  ytDlpCookiesFilePath: '',
  defaultWhisperModel: 'base',
  minimaxApiKey: '',
  minimaxApiBaseUrl: 'https://api.minimaxi.com',
  translateModelId: '',
  translateTemperature: 0.3,
  ttsModelId: '',
  ttsVoiceId: '',
  ttsSpeed: 1,
  ttsPitch: 0,
  ttsVolume: 1,
  defaultTargetLanguage: 'zh',
  stageTimeoutMs: 10 * 60 * 1000,
  retryPolicy: {
    download: 2,
    translate: 2,
    tts: 2,
    transcribe: 0,
  },
}

function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')

  const [taskForm, setTaskForm] = useState<TaskFormState>({
    youtubeUrl: '',
    targetLanguage: 'zh',
  })

  const [activeTaskId, setActiveTaskId] = useState('')
  const [activeStatus, setActiveStatus] = useState<TaskStatus | ''>('')
  const [stageProgress, setStageProgress] = useState<Record<string, number>>({})
  const [logs, setLogs] = useState<LogItem[]>([])
  const [output, setOutput] = useState<TaskOutput>({})
  const [taskRunning, setTaskRunning] = useState(false)
  const [taskError, setTaskError] = useState('')

  const isStartDisabled = useMemo(() => {
    return taskRunning || !taskForm.youtubeUrl.trim()
  }, [taskRunning, taskForm.youtubeUrl])

  function pushLog(item: Omit<LogItem, 'id'>): void {
    setLogs((prev) => [
      ...prev.slice(-199),
      {
        ...item,
        id: Date.now() + Math.floor(Math.random() * 1000),
      },
    ])
  }

  useEffect(() => {
    let mounted = true

    const loadSettings = async () => {
      setSettingsLoading(true)
      setSettingsError('')
      try {
        const result = await ipcClient.settings.get()
        if (!mounted) return
        setSettings(result)
        setTaskForm((prev) => ({
          ...prev,
          targetLanguage: result.defaultTargetLanguage,
        }))
      } catch (error) {
        if (!mounted) return
        setSettingsError(error instanceof Error ? error.message : 'Failed to load settings')
      } finally {
        if (mounted) setSettingsLoading(false)
      }
    }

    void loadSettings()

    const offStatus = ipcClient.task.onStatus((payload) => {
      if (payload.taskId !== activeTaskId && activeTaskId) return
      setActiveTaskId(payload.taskId)
      setActiveStatus(payload.status)
      setTaskRunning(
        payload.status === 'queued' ||
          payload.status === 'downloading' ||
          payload.status === 'extracting' ||
          payload.status === 'transcribing' ||
          payload.status === 'translating' ||
          payload.status === 'synthesizing' ||
          payload.status === 'merging',
      )
      pushLog({
        time: payload.timestamp,
        stage: 'status',
        level: 'info',
        text: `Status -> ${payload.status}`,
      })
    })

    const offProgress = ipcClient.task.onProgress((payload) => {
      if (payload.taskId !== activeTaskId && activeTaskId) return
      setActiveTaskId(payload.taskId)
      setStageProgress((prev) => ({ ...prev, [payload.stage]: payload.percent }))
    })

    const offLog = ipcClient.task.onLog((payload) => {
      if (payload.taskId !== activeTaskId && activeTaskId) return
      pushLog({
        time: payload.timestamp,
        stage: payload.stage,
        level: payload.level,
        text: payload.text,
      })
    })

    const offCompleted = ipcClient.task.onCompleted((payload) => {
      if (payload.taskId !== activeTaskId && activeTaskId) return
      setTaskRunning(false)
      setOutput(payload.output)
      pushLog({
        time: new Date().toISOString(),
        stage: 'completed',
        level: 'info',
        text: 'Task completed',
      })
    })

    const offFailed = ipcClient.task.onFailed((payload) => {
      if (payload.taskId !== activeTaskId && activeTaskId) return
      setTaskRunning(false)
      setTaskError(payload.errorMessage)
      pushLog({
        time: new Date().toISOString(),
        stage: payload.stage,
        level: 'error',
        text: `${payload.errorCode}: ${payload.errorMessage}`,
      })
    })

    return () => {
      mounted = false
      offStatus()
      offProgress()
      offLog()
      offCompleted()
      offFailed()
    }
  }, [activeTaskId])

  async function saveSettings(): Promise<void> {
    setSettingsSaving(true)
    setSettingsError('')
    try {
      const saved = await ipcClient.settings.update(settings)
      setSettings(saved)
      pushLog({
        time: new Date().toISOString(),
        stage: 'settings',
        level: 'info',
        text: 'Settings saved',
      })
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : 'Failed to save settings')
    } finally {
      setSettingsSaving(false)
    }
  }

  async function startTask(): Promise<void> {
    if (!taskForm.youtubeUrl.trim()) return

    setTaskError('')
    setOutput({})
    setStageProgress({})
    setLogs([])

    try {
      const task = await ipcClient.task.create({
        youtubeUrl: taskForm.youtubeUrl.trim(),
        targetLanguage: taskForm.targetLanguage,
        whisperModel: settings.defaultWhisperModel,
      })
      setActiveTaskId(task.id)

      const result = await ipcClient.task.start({ taskId: task.id })
      if (!result.accepted) {
        throw new Error(result.reason ?? 'Task was not accepted')
      }
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Failed to start task')
    }
  }

  async function cancelTask(): Promise<void> {
    if (!activeTaskId) return
    try {
      await ipcClient.task.cancel({ taskId: activeTaskId })
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : 'Failed to cancel task')
    }
  }

  return (
    <main className="app">
      <header className="topbar">
        <h1>YouTube Transcription Workbench</h1>
        <p>Real pipeline: yt-dlp + ffmpeg + whisper + MiniMax</p>
      </header>

      <section className="panel">
        <h2>Settings</h2>
        {settingsLoading && <p className="hint">Loading settings...</p>}

        <div className="grid">
          <label>
            YouTube Download Auth
            <select
              value={settings.ytDlpAuthMode}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  ytDlpAuthMode: e.target.value as AppSettings['ytDlpAuthMode'],
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
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    ytDlpCookiesBrowser: e.target.value as AppSettings['ytDlpCookiesBrowser'],
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
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    ytDlpCookiesFilePath: e.target.value,
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
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  defaultWhisperModel: e.target.value as AppSettings['defaultWhisperModel'],
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
              onChange={(e) => setSettings((prev) => ({ ...prev, minimaxApiKey: e.target.value }))}
              placeholder="sk-..."
            />
          </label>

          <label>
            MiniMax Base URL
            <input
              type="text"
              value={settings.minimaxApiBaseUrl}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, minimaxApiBaseUrl: e.target.value.trim() }))
              }
              placeholder="https://api.minimaxi.com"
            />
          </label>

          <label>
            Translate Model ID
            <input
              type="text"
              value={settings.translateModelId}
              onChange={(e) => setSettings((prev) => ({ ...prev, translateModelId: e.target.value }))}
            />
          </label>

          <label>
            TTS Model ID
            <input
              type="text"
              value={settings.ttsModelId}
              onChange={(e) => setSettings((prev) => ({ ...prev, ttsModelId: e.target.value }))}
            />
          </label>

          <label>
            TTS Voice ID
            <input
              type="text"
              value={settings.ttsVoiceId}
              onChange={(e) => setSettings((prev) => ({ ...prev, ttsVoiceId: e.target.value }))}
            />
          </label>

          <label>
            Default Target Language
            <select
              value={settings.defaultTargetLanguage}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  defaultTargetLanguage: e.target.value as 'zh' | 'en' | 'ja',
                }))
              }
            >
              <option value="zh">zh</option>
              <option value="en">en</option>
              <option value="ja">ja</option>
            </select>
          </label>
        </div>

        <div className="actions">
          <button className="btn primary" onClick={() => void saveSettings()} disabled={settingsSaving}>
            {settingsSaving ? 'Saving...' : 'Save Settings'}
          </button>
          {settingsError && <span className="error">{settingsError}</span>}
        </div>
      </section>

      <section className="panel">
        <h2>Run Task</h2>

        <div className="grid">
          <label className="full">
            YouTube URL
            <input
              type="text"
              value={taskForm.youtubeUrl}
              onChange={(e) => setTaskForm((prev) => ({ ...prev, youtubeUrl: e.target.value }))}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </label>

          <label>
            Target Language
            <select
              value={taskForm.targetLanguage}
              onChange={(e) =>
                setTaskForm((prev) => ({
                  ...prev,
                  targetLanguage: e.target.value as 'zh' | 'en' | 'ja',
                }))
              }
            >
              <option value="zh">zh</option>
              <option value="en">en</option>
              <option value="ja">ja</option>
            </select>
          </label>
        </div>

        <div className="actions">
          <button className="btn primary" disabled={isStartDisabled} onClick={() => void startTask()}>
            Start Task
          </button>
          <button className="btn" disabled={!taskRunning} onClick={() => void cancelTask()}>
            Cancel Task
          </button>
          {taskError && <span className="error">{taskError}</span>}
        </div>

        <div className="status">
          <span>Task ID: {activeTaskId || '-'}</span>
          <span>Status: {activeStatus || '-'}</span>
        </div>

        <ul className="progress-list">
          {STAGES.map((stage) => (
            <li key={stage}>
              <span>{stage}</span>
              <div className="bar">
                <div className="fill" style={{ width: `${stageProgress[stage] ?? 0}%` }} />
              </div>
              <span>{stageProgress[stage] ?? 0}%</span>
            </li>
          ))}
        </ul>

        <div className="output">
          <p>transcript: {output.transcriptPath || '-'}</p>
          <p>translation: {output.translationPath || '-'}</p>
          <p>tts: {output.ttsPath || '-'}</p>
        </div>
      </section>

      <section className="panel">
        <h2>Logs</h2>
        <div className="logbox">
          {logs.length === 0 && <p className="hint">No logs yet.</p>}
          {logs.map((log) => (
            <p key={log.id} className={`log ${log.level}`}>
              [{new Date(log.time).toLocaleTimeString()}] [{log.stage}] {log.text}
            </p>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
