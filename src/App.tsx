import { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  createTranslator,
  getInitialLocale,
  saveLocale,
  type AppLocale,
} from './app/i18n'
import { DEFAULT_SETTINGS, STAGES, formatDateTime } from './app/utils'
import { useTaskAudio } from './app/hooks/useTaskAudio'
import { useTaskEvents } from './app/hooks/useTaskEvents'
import { SidebarMenu } from './components/SidebarMenu'
import { HistoryPage } from './pages/HistoryPage'
import { SettingsPage } from './pages/SettingsPage'
import { TaskPage } from './pages/TaskPage'
import { ipcClient } from './services/ipcClient'
import './App.css'

function App() {
  const [activeRoute, setActiveRoute] = useState<AppRoute>('task')
  const [locale, setLocale] = useState<AppLocale>(() => getInitialLocale())
  const [settingsState, setSettingsState] = useState(createInitialSettingsState)
  const [taskState, setTaskState] = useState<TaskState>(createInitialTaskState)
  const [historyState, setHistoryState] = useState<HistoryState>(createInitialHistoryState)
  const t = useMemo(() => createTranslator(locale), [locale])

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

  const pushLog = useCallback((item: Omit<LogItem, 'id'>): void => {
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
  }, [])

  const loadHistory = useCallback(async (query: HistoryQueryState): Promise<void> => {
    await loadHistoryAction({
      ipcClient,
      setHistoryState,
      query,
      t,
    })
  }, [t])

  const loadTaskDetail = useCallback(async (taskId: string): Promise<void> => {
    await loadTaskDetailAction({
      ipcClient,
      setTaskState,
      setActiveRoute,
      pushLog,
      taskId,
      t,
    })
  }, [pushLog, t])

  useEffect(() => {
    void loadHistory(historyState.query)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loadHistory,
    historyState.query.page,
    historyState.query.pageSize,
    historyState.query.status,
    historyState.query.targetLanguage,
    historyState.query.keyword,
  ])

  useEffect(() => {
    saveLocale(locale)
  }, [locale])

  useEffect(() => {
    let mounted = true

    void loadSettingsAction({
      ipcClient,
      setSettingsState,
      setTaskState,
      isMounted: () => mounted,
      t,
    })

    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useTaskEvents({
    ipcClient,
    activeTaskId: taskState.activeTaskId,
    historyQuery: historyState.query,
    setTaskState,
    pushLog,
    refreshHistory: loadHistory,
    t,
  })

  useTaskAudio({
    ipcClient,
    ttsPath: taskState.output.ttsPath,
    setTaskState,
    pushLog,
    t,
  })

  async function saveSettings(): Promise<void> {
    await saveSettingsAction({
      settings: settingsState.data,
      ipcClient,
      setSettingsState,
      setTaskState,
      pushLog,
      t,
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
      t,
    })
  }

  async function cancelTask(): Promise<void> {
    await cancelTaskAction({
      activeTaskId: taskState.activeTaskId,
      ipcClient,
      setTaskState,
      t,
    })
  }

  async function handleDownloadAudio(): Promise<void> {
    await handleDownloadAudioAction({
      ttsPath: taskState.output.ttsPath,
      ipcClient,
      pushLog,
      t,
    })
  }

  async function handleOpenOutputDirectory(): Promise<void> {
    await handleOpenOutputDirectoryAction({
      output: taskState.output,
      ipcClient,
      pushLog,
      t,
    })
  }

  async function handleExportDiagnostics(taskId?: string): Promise<void> {
    await handleExportDiagnosticsAction({
      taskId,
      ipcClient,
      pushLog,
      t,
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
        window.confirm(t('history.deleteConfirm', { taskId: targetTaskId })),
      refreshHistory: loadHistory,
      ipcClient,
      setHistoryState,
      setTaskState,
      pushLog,
      t,
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
      t,
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

  // Calculate overall progress based on active status and stage progress
  const overallProgress = useMemo(() => {
    if (!taskState.activeStatus || !taskState.running) {
      return 0
    }
    // Find current stage index
    const currentStageIndex = STAGES.findIndex((s) => s === taskState.activeStatus)
    if (currentStageIndex === -1) {
      return 0
    }
    // Calculate base progress from completed stages
    const stageWeight = 100 / STAGES.length
    const baseProgress = currentStageIndex * stageWeight
    // Add current stage progress
    const currentStageProgress = taskState.stageProgress[taskState.activeStatus] ?? 0
    const stageContribution = (currentStageProgress / 100) * stageWeight

    return Math.round(baseProgress + stageContribution)
  }, [taskState.activeStatus, taskState.running, taskState.stageProgress])

  const taskPageModel = {
    stages: STAGES,
    taskForm: taskState.form,
    isStartDisabled,
    taskRunning: taskState.running,
    taskError: taskState.error,
    activeTaskId: taskState.activeTaskId,
    activeStatus: taskState.activeStatus,
    stageProgress: taskState.stageProgress,
    overallProgress,
    runtimeItems: taskState.runtimeItems,
    output: taskState.output,
    ttsAudioUrl: taskState.ttsAudioUrl,
    logs: taskState.logs,
    transcriptContent: taskState.transcriptContent,
    translationContent: taskState.translationContent,
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
    formatDateTime: (value: string | null) => formatDateTime(value, locale),
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="topbar-row">
          <div>
            <h1>{t('app.title')}</h1>
            <p>{t('app.subtitle')}</p>
          </div>
          <div className="locale-switch" role="group" aria-label={t('app.localeSwitcherLabel')}>
            <button
              className={`locale-btn ${locale === 'zh-CN' ? 'active' : ''}`}
              onClick={() => setLocale('zh-CN')}
              type="button"
            >
              {t('app.locale.zhCN')}
            </button>
            <button
              className={`locale-btn ${locale === 'zh-TW' ? 'active' : ''}`}
              onClick={() => setLocale('zh-TW')}
              type="button"
            >
              {t('app.locale.zhTW')}
            </button>
          </div>
        </div>
      </header>

      <div className="workspace">
        <SidebarMenu activeRoute={activeRoute} onRouteChange={setActiveRoute} t={t} />

        <div className="main-view">
          {activeRoute === 'settings' && (
            <SettingsPage model={settingsPageModel} actions={settingsPageActions} t={t} />
          )}

          {activeRoute === 'task' && <TaskPage model={taskPageModel} actions={taskPageActions} t={t} />}

          {activeRoute === 'history' && (
            <HistoryPage model={historyPageModel} actions={historyPageActions} t={t} />
          )}
        </div>
      </div>
    </main>
  )
}

export default App
