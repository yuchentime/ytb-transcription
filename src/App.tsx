import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings, TaskStatus } from '../electron/core/db/types'
import {
  applyHistoryFiltersAction,
  cancelTaskAction,
  handleDeleteHistoryTaskAction,
  handleDownloadAudioAction,
  handleExportDiagnosticsAction,
  handleOpenOutputDirectoryAction,
  handleRetryHistoryTaskAction,
  loadHistoryAction,
  loadSettingsAction,
  loadTaskDetailAction,
  saveSettingsAction,
  startTaskAction,
} from './app/actions'
import type { AppRoute } from './app/router'
import type {
  HistoryQueryState,
  HistoryState,
  LogItem,
  TaskFormState,
  TaskState,
} from './app/state'
import {
  createInitialHistoryState,
  createInitialSettingsState,
  createInitialTaskState,
} from './app/state'
import { DEFAULT_SETTINGS, STAGES, formatDateTime, isRunningStatus } from './app/utils'
import { SidebarMenu } from './components/SidebarMenu'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { TaskPage } from './pages/TaskPage'
import { ipcClient } from './services/ipcClient'
import './App.css'

function App() {
  const [activeRoute, setActiveRoute] = useState<AppRoute>('task')
  const [settingsState, setSettingsState] = useState(createInitialSettingsState)
  const [taskState, setTaskState] = useState<TaskState>(createInitialTaskState)
  const [historyState, setHistoryState] = useState<HistoryState>(createInitialHistoryState)

  const historyTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(historyState.total / historyState.query.pageSize))
  }, [historyState.total, historyState.query.pageSize])

  const isStartDisabled = useMemo(() => {
    return taskState.running || !taskState.form.youtubeUrl.trim()
  }, [taskState.running, taskState.form.youtubeUrl])

  const setSettingsData: Dispatch<SetStateAction<AppSettings>> = (updater) => {
    setSettingsState((prev) => ({
      ...prev,
      data:
        typeof updater === 'function'
          ? (updater as (previous: AppSettings) => AppSettings)(prev.data)
          : updater,
    }))
  }

  const setTaskFormData: Dispatch<SetStateAction<TaskFormState>> = (updater) => {
    setTaskState((prev) => ({
      ...prev,
      form:
        typeof updater === 'function'
          ? (updater as (previous: TaskFormState) => TaskFormState)(prev.form)
          : updater,
    }))
  }

  function pushLog(item: Omit<LogItem, 'id'>): void {
    setTaskState((prev) => ({
      ...prev,
      logs: [
        ...prev.logs.slice(-199),
        {
          ...item,
          id: Date.now() + Math.floor(Math.random() * 1000),
        },
      ],
    }))
  }

  async function loadHistory(query: HistoryQueryState = historyState.query): Promise<void> {
    await loadHistoryAction({
      ipcClient,
      setHistoryState,
      query,
    })
  }

  async function loadTaskDetail(taskId: string): Promise<void> {
    await loadTaskDetailAction({
      ipcClient,
      setTaskState,
      setActiveRoute,
      pushLog,
      taskId,
    })
  }

  useEffect(() => {
    void loadHistory(historyState.query)
  }, [
    historyState.query.page,
    historyState.query.pageSize,
    historyState.query.status,
    historyState.query.targetLanguage,
    historyState.query.keyword,
  ])

  useEffect(() => {
    let mounted = true

    void loadSettingsAction({
      ipcClient,
      setSettingsState,
      setTaskState,
      isMounted: () => mounted,
    })

    const offStatus = ipcClient.task.onStatus((payload) => {
      if (payload.taskId !== taskState.activeTaskId && taskState.activeTaskId) return
      setTaskState((prev) => ({
        ...prev,
        activeTaskId: payload.taskId,
        activeStatus: payload.status,
        running: isRunningStatus(payload.status),
      }))

      pushLog({
        time: payload.timestamp,
        stage: 'status',
        level: 'info',
        text: `Status -> ${payload.status}`,
      })
    })

    const offProgress = ipcClient.task.onProgress((payload) => {
      if (payload.taskId !== taskState.activeTaskId && taskState.activeTaskId) return
      setTaskState((prev) => ({
        ...prev,
        activeTaskId: payload.taskId,
        stageProgress: {
          ...prev.stageProgress,
          [payload.stage]: payload.percent,
        },
      }))
    })

    const offRuntime = ipcClient.task.onRuntime((payload) => {
      if (payload.taskId !== taskState.activeTaskId && taskState.activeTaskId) return
      setTaskState((prev) => ({
        ...prev,
        runtimeItems: {
          ...prev.runtimeItems,
          [payload.component]: {
            component: payload.component,
            status: payload.status,
            message: payload.message,
            timestamp: payload.timestamp,
          },
        },
      }))
    })

    const offLog = ipcClient.task.onLog((payload) => {
      if (payload.taskId !== taskState.activeTaskId && taskState.activeTaskId) return
      pushLog({
        time: payload.timestamp,
        stage: payload.stage,
        level: payload.level,
        text: payload.text,
      })
    })

    const offCompleted = ipcClient.task.onCompleted((payload) => {
      if (payload.taskId !== taskState.activeTaskId && taskState.activeTaskId) return
      setTaskState((prev) => ({
        ...prev,
        running: false,
        error: '',
        output: payload.output,
      }))

      pushLog({
        time: new Date().toISOString(),
        stage: 'completed',
        level: 'info',
        text: 'Task completed',
      })
      void loadHistory(historyState.query)
    })

    const offFailed = ipcClient.task.onFailed((payload) => {
      if (payload.taskId !== taskState.activeTaskId && taskState.activeTaskId) return
      setTaskState((prev) => ({
        ...prev,
        running: false,
        error: payload.errorMessage,
      }))

      pushLog({
        time: new Date().toISOString(),
        stage: payload.stage,
        level: 'error',
        text: `${payload.errorCode}: ${payload.errorMessage}`,
      })
      void loadHistory(historyState.query)
    })

    return () => {
      mounted = false
      offStatus()
      offProgress()
      offRuntime()
      offLog()
      offCompleted()
      offFailed()
    }
  }, [taskState.activeTaskId, historyState.query])

  useEffect(() => {
    let objectUrl: string | null = null
    let disposed = false

    const loadAudio = async () => {
      if (!taskState.output.ttsPath) {
        setTaskState((prev) => ({
          ...prev,
          ttsAudioUrl: '',
        }))
        return
      }

      try {
        const { data, mimeType } = await ipcClient.file.readAudio(taskState.output.ttsPath)
        const blob = new Blob([data], { type: mimeType })
        const url = URL.createObjectURL(blob)

        if (disposed) {
          URL.revokeObjectURL(url)
          return
        }

        objectUrl = url
        setTaskState((prev) => ({
          ...prev,
          ttsAudioUrl: url,
        }))
      } catch (error) {
        pushLog({
          time: new Date().toISOString(),
          stage: 'tts',
          level: 'error',
          text: `Failed to load audio: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }

    void loadAudio()

    return () => {
      disposed = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [taskState.output.ttsPath])

  async function saveSettings(): Promise<void> {
    await saveSettingsAction({
      settings: settingsState.data,
      ipcClient,
      setSettingsState,
      setTaskState,
      pushLog,
    })
  }

  async function startTask(): Promise<void> {
    await startTaskAction({
      taskForm: taskState.form,
      settings: settingsState.data,
      ipcClient,
      setTaskState,
      setActiveRoute,
      refreshHistory: loadHistory,
      historyQuery: historyState.query,
    })
  }

  async function cancelTask(): Promise<void> {
    await cancelTaskAction({
      activeTaskId: taskState.activeTaskId,
      ipcClient,
      setTaskState,
    })
  }

  async function handleDownloadAudio(): Promise<void> {
    await handleDownloadAudioAction({
      ttsPath: taskState.output.ttsPath,
      ipcClient,
      pushLog,
    })
  }

  async function handleOpenOutputDirectory(): Promise<void> {
    await handleOpenOutputDirectoryAction({
      output: taskState.output,
      ipcClient,
      pushLog,
    })
  }

  async function handleExportDiagnostics(taskId?: string): Promise<void> {
    await handleExportDiagnosticsAction({
      taskId,
      ipcClient,
      pushLog,
    })
  }

  function applyHistoryFilters(): void {
    applyHistoryFiltersAction({
      setHistoryState,
    })
  }

  async function handleDeleteHistoryTask(taskId: string): Promise<void> {
    await handleDeleteHistoryTaskAction({
      taskId,
      activeTaskId: taskState.activeTaskId,
      historyQuery: historyState.query,
      confirmDelete: (targetTaskId) =>
        window.confirm(
          `Delete task ${targetTaskId}? This will remove DB records and local artifacts.`,
        ),
      refreshHistory: loadHistory,
      ipcClient,
      setHistoryState,
      setTaskState,
      pushLog,
    })
  }

  async function handleRetryHistoryTask(taskId: string): Promise<void> {
    await handleRetryHistoryTaskAction({
      taskId,
      historyQuery: historyState.query,
      refreshHistory: loadHistory,
      setActiveRoute,
      ipcClient,
      setHistoryState,
      setTaskState,
      pushLog,
    })
  }

  const settingsPageModel = {
    settings: settingsState.data,
    settingsLoading: settingsState.loading,
    settingsSaving: settingsState.saving,
    settingsError: settingsState.error,
    defaultStageTimeoutMs: DEFAULT_SETTINGS.stageTimeoutMs,
  }
  const settingsPageActions = {
    setSettings: setSettingsData,
    onSave: saveSettings,
  }

  const taskPageModel = {
    stages: STAGES,
    taskForm: taskState.form,
    isStartDisabled,
    taskRunning: taskState.running,
    taskError: taskState.error,
    activeTaskId: taskState.activeTaskId,
    activeStatus: taskState.activeStatus,
    stageProgress: taskState.stageProgress,
    runtimeItems: taskState.runtimeItems,
    output: taskState.output,
    ttsAudioUrl: taskState.ttsAudioUrl,
    logs: taskState.logs,
  }
  const taskPageActions = {
    setTaskForm: setTaskFormData,
    onStartTask: startTask,
    onCancelTask: cancelTask,
    onExportDiagnostics: (taskId: string) => handleExportDiagnostics(taskId),
    onDownloadAudio: handleDownloadAudio,
    onOpenOutputDirectory: handleOpenOutputDirectory,
  }

  const historyPageModel = {
    historyKeywordDraft: historyState.keywordDraft,
    historyStatusDraft: historyState.statusDraft,
    historyLanguageDraft: historyState.languageDraft,
    historyPageSize: historyState.query.pageSize,
    historyError: historyState.error,
    historyLoading: historyState.loading,
    historyItems: historyState.items,
    historyBusyTaskId: historyState.busyTaskId,
    historyPage: historyState.query.page,
    historyTotalPages,
    historyTotal: historyState.total,
    canPrevPage: historyState.query.page > 1 && !historyState.loading,
    canNextPage: historyState.query.page < historyTotalPages && !historyState.loading,
  }
  const historyPageActions = {
    onHistoryKeywordDraftChange: (value: string) =>
      setHistoryState((prev) => ({
        ...prev,
        keywordDraft: value,
      })),
    onHistoryStatusDraftChange: (value: 'all' | TaskStatus) =>
      setHistoryState((prev) => ({
        ...prev,
        statusDraft: value,
      })),
    onHistoryLanguageDraftChange: (value: 'all' | 'zh' | 'en' | 'ja') =>
      setHistoryState((prev) => ({
        ...prev,
        languageDraft: value,
      })),
    onHistoryPageSizeChange: (pageSize: number) =>
      setHistoryState((prev) => ({
        ...prev,
        query: {
          ...prev.query,
          page: 1,
          pageSize,
        },
      })),
    onApplyFilters: applyHistoryFilters,
    onRefresh: () => loadHistory(historyState.query),
    onLoadTaskDetail: loadTaskDetail,
    onRetryTask: handleRetryHistoryTask,
    onDeleteTask: handleDeleteHistoryTask,
    onExportDiagnostics: (taskId: string) => handleExportDiagnostics(taskId),
    onPrevPage: () =>
      setHistoryState((prev) => ({
        ...prev,
        query: {
          ...prev.query,
          page: Math.max(1, prev.query.page - 1),
        },
      })),
    onNextPage: () =>
      setHistoryState((prev) => ({
        ...prev,
        query: {
          ...prev.query,
          page: Math.min(historyTotalPages, prev.query.page + 1),
        },
      })),
    formatDateTime,
  }

  return (
    <main className="app">
      <header className="topbar">
        <h1>YouTube Transcription Workbench</h1>
        <p>Real pipeline: yt-dlp + ffmpeg + whisper + MiniMax</p>
      </header>

      <div className="workspace">
        <SidebarMenu activeRoute={activeRoute} onRouteChange={setActiveRoute} />

        <div className="main-view">
          {activeRoute === 'settings' && (
            <SettingsPage model={settingsPageModel} actions={settingsPageActions} />
          )}

          {activeRoute === 'task' && <TaskPage model={taskPageModel} actions={taskPageActions} />}

          {activeRoute === 'history' && (
            <HistoryPage model={historyPageModel} actions={historyPageActions} />
          )}
        </div>
      </div>
    </main>
  )
}

export default App
