import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings, TaskStatus } from '../electron/core/db/types'
import type { PiperInstallResult, PiperProbeResult, TranslateConnectivityResult } from '../electron/ipc/channels'
import {
  applyHistoryFiltersAction,
  cancelTaskAction,
  handleDeleteHistoryTaskAction,
  handleDownloadAudioAction,
  handleExportDiagnosticsAction,
  handleOpenOutputDirectoryAction,
  loadHistoryAction,
  loadSettingsAction,
  loadTaskDetailAction,
  resumeTaskFromCheckpointAction,
  retryFailedSegmentsAction,
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
import { DEFAULT_SETTINGS, STAGES, formatDateTime, isRecoverableTaskStatus } from './app/utils'
import { useTaskAudio } from './app/hooks/useTaskAudio'
import { useTaskEvents } from './app/hooks/useTaskEvents'
import { SidebarMenu } from './components/SidebarMenu'
import { ConfirmDialog } from './components/ConfirmDialog'
import { AboutPage } from './pages/AboutPage'
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
  const [playingAudio, setPlayingAudio] = useState<{ taskId: string; url: string; title: string } | null>(null)
  const playingAudioUrlRef = useRef<string>('')
  const [resumeConfirmDialog, setResumeConfirmDialog] = useState<{
    open: boolean
    runningTaskId: string
    targetTaskId: string
  }>({
    open: false,
    runningTaskId: '',
    targetTaskId: '',
  })
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
    open: boolean
    targetTaskId: string
  }>({
    open: false,
    targetTaskId: '',
  })
  const resumeConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null)
  const deleteConfirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null)
  const t = useMemo(() => createTranslator(locale), [locale])

  const filteredHistoryItems = useMemo(() => {
    if (!historyState.recoverableOnly) return historyState.items
    return historyState.items.filter((item) => isRecoverableTaskStatus(item.status))
  }, [historyState.items, historyState.recoverableOnly])

  const historyVisibleTotal = useMemo(() => {
    return historyState.recoverableOnly ? filteredHistoryItems.length : historyState.total
  }, [filteredHistoryItems.length, historyState.recoverableOnly, historyState.total])

  const historyTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(historyVisibleTotal / historyState.query.pageSize))
  }, [historyVisibleTotal, historyState.query.pageSize])

  const taskFormErrors = useMemo(() => {
    const errors: string[] = []
    const voiceId = taskState.form.ttsVoiceId.trim()
    const isPiperTts = settingsState.data.ttsProvider === 'piper'

    if (!taskState.form.youtubeUrl.trim()) {
      errors.push('请输入有效的 YouTube 链接')
    }
    if (!isPiperTts && !settingsState.data.ttsModelId.trim()) {
      errors.push('请先在设置页选择 TTS 模型')
    }
    if (isPiperTts && !settingsState.data.piperModelPath.trim()) {
      errors.push('请先在设置页配置 Piper 模型路径')
    }
    if (!isPiperTts && !voiceId) {
      errors.push('请选择音色预设')
    }
    if (!isPiperTts && voiceId && settingsState.voiceProfiles.length > 0) {
      const selectedVoice = settingsState.voiceProfiles.find((voice) => voice.id === voiceId)
      if (!selectedVoice) {
        errors.push('音色不存在，请重新选择')
      } else if (
        selectedVoice.language !== 'multi' &&
        selectedVoice.language !== taskState.form.targetLanguage
      ) {
        errors.push(`音色语言(${selectedVoice.language})与目标语言(${taskState.form.targetLanguage})不一致`)
      }
    }

    return errors
  }, [settingsState.data.piperModelPath, settingsState.data.ttsModelId, settingsState.data.ttsProvider, settingsState.voiceProfiles, taskState.form])

  const isStartDisabled = useMemo(() => {
    return taskState.running || taskFormErrors.length > 0
  }, [taskState.running, taskFormErrors.length])

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

  const requestResumeOverrideConfirm = useCallback(
    async (runningTaskId: string, targetTaskId: string): Promise<boolean> => {
      return await new Promise<boolean>((resolve) => {
        if (resumeConfirmResolverRef.current) {
          resumeConfirmResolverRef.current(false)
        }
        resumeConfirmResolverRef.current = resolve
        setResumeConfirmDialog({
          open: true,
          runningTaskId,
          targetTaskId,
        })
      })
    },
    [],
  )

  const resolveResumeOverrideConfirm = useCallback((confirmed: boolean): void => {
    const resolver = resumeConfirmResolverRef.current
    resumeConfirmResolverRef.current = null
    setResumeConfirmDialog((prev) => ({
      ...prev,
      open: false,
    }))
    resolver?.(confirmed)
  }, [])

  const requestDeleteConfirm = useCallback(async (targetTaskId: string): Promise<boolean> => {
    return await new Promise<boolean>((resolve) => {
      if (deleteConfirmResolverRef.current) {
        deleteConfirmResolverRef.current(false)
      }
      deleteConfirmResolverRef.current = resolve
      setDeleteConfirmDialog({
        open: true,
        targetTaskId,
      })
    })
  }, [])

  const resolveDeleteConfirm = useCallback((confirmed: boolean): void => {
    const resolver = deleteConfirmResolverRef.current
    deleteConfirmResolverRef.current = null
    setDeleteConfirmDialog((prev) => ({
      ...prev,
      open: false,
    }))
    resolver?.(confirmed)
  }, [])

  const stopPlayingAudio = useCallback(() => {
    setPlayingAudio((prev) => {
      if (prev?.url) {
        URL.revokeObjectURL(prev.url)
      }
      return null
    })
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
    playingAudioUrlRef.current = playingAudio?.url ?? ''
  }, [playingAudio?.url])

  useEffect(() => {
    return () => {
      if (playingAudioUrlRef.current) {
        URL.revokeObjectURL(playingAudioUrlRef.current)
      }
      if (deleteConfirmResolverRef.current) {
        deleteConfirmResolverRef.current(false)
        deleteConfirmResolverRef.current = null
      }
      if (resumeConfirmResolverRef.current) {
        resumeConfirmResolverRef.current(false)
        resumeConfirmResolverRef.current = null
      }
    }
  }, [])

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

  async function probePiper(settings: AppSettings): Promise<PiperProbeResult> {
    return await ipcClient.system.probePiper({ settings })
  }

  async function installPiper(settings: AppSettings, forceReinstall = false): Promise<PiperInstallResult> {
    return await ipcClient.system.installPiper({
      settings: {
        ...settings,
        defaultTargetLanguage: taskState.form.targetLanguage,
      },
      forceReinstall,
    })
  }

  async function testTranslateConnectivity(settings: AppSettings): Promise<TranslateConnectivityResult> {
    return await ipcClient.system.testTranslateConnectivity({
      settings: {
        ...settings,
        defaultTargetLanguage: taskState.form.targetLanguage,
      },
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
    const confirmed = await requestDeleteConfirm(taskId)
    if (!confirmed) return

    await handleDeleteHistoryTaskAction({
      taskId,
      activeTaskId: taskState.activeTaskId,
      historyQuery: historyState.query,
      confirmDelete: () => true,
      refreshHistory: loadHistory,
      ipcClient,
      setHistoryState,
      setTaskState,
      pushLog,
      t,
    })
  }

  async function handleDownloadHistoryArtifacts(taskId: string): Promise<void> {
    setHistoryState((prev) => ({
      ...prev,
      busyTaskId: taskId,
      error: '',
    }))

    try {
      const result = await ipcClient.system.exportTaskArtifacts({ taskId })
      await ipcClient.system.openPath({ path: result.exportDir })

      pushLog({
        time: new Date().toISOString(),
        stage: 'history',
        level: 'info',
        text: t('log.artifactsExported', { taskId, count: result.files.length }),
      })
    } catch (error) {
      setHistoryState((prev) => ({
        ...prev,
        error:
          error instanceof Error
            ? t('error.downloadArtifacts', { message: error.message })
            : t('error.downloadArtifacts', { message: '' }),
      }))
    } finally {
      setHistoryState((prev) => ({
        ...prev,
        busyTaskId: '',
      }))
    }
  }

  async function handleRetryFailedSegments(segmentIds?: string[]): Promise<void> {
    await retryFailedSegmentsAction({
      activeTaskId: taskState.activeTaskId,
      ipcClient,
      setTaskState,
      segmentIds,
      pushLog,
      t,
    })
  }

  async function handleResumeFromCheckpoint(taskId = taskState.activeTaskId): Promise<void> {
    await resumeTaskFromCheckpointAction({
      activeTaskId: taskId,
      ipcClient,
      setTaskState,
      pushLog,
      t,
    })
    setActiveRoute('task')
  }

  async function waitUntilNoRunningTask(timeoutMs = 15000): Promise<void> {
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      const runningTask = await ipcClient.task.getRunning().catch(() => null)
      if (!runningTask) return
      await new Promise((resolve) => {
        window.setTimeout(resolve, 250)
      })
    }
    throw new Error(t('error.cancelTask'))
  }

  async function handleResumeHistoryTask(taskId: string): Promise<void> {
    setHistoryState((prev) => ({
      ...prev,
      busyTaskId: taskId,
      error: '',
    }))

    try {
      const runningTask = await ipcClient.task.getRunning().catch(() => null)
      if (runningTask && runningTask.id !== taskId) {
        const shouldOverride = await requestResumeOverrideConfirm(runningTask.id, taskId)
        if (!shouldOverride) return
        const cancelResult = await ipcClient.task.cancel({ taskId: runningTask.id })
        if (!cancelResult.canceled) {
          throw new Error(t('error.cancelTask'))
        }
        await waitUntilNoRunningTask()
      }

      await loadTaskDetail(taskId)
      const activeRunningTask = await ipcClient.task.getRunning().catch(() => null)
      if (activeRunningTask?.id === taskId) {
        setActiveRoute('task')
        pushLog({
          time: new Date().toISOString(),
          stage: 'history',
          level: 'info',
          text: `任务已在运行：${taskId}`,
        })
      } else {
        await handleResumeFromCheckpoint(taskId)
      }
    } catch (error) {
      setHistoryState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : t('error.retryTask'),
      }))
    } finally {
      setHistoryState((prev) => ({
        ...prev,
        busyTaskId: '',
      }))
      await loadHistory(historyState.query)
    }
  }

  const settingsPageModel = {
    settings: settingsState.data,
    settingsLoading: settingsState.loading,
    settingsSaving: settingsState.saving,
    settingsError: settingsState.error,
    settingsSaveSuccess: settingsState.saveSuccess,
    settingsSaveError: settingsState.saveError,
    settingsSaveErrorMessage: settingsState.saveErrorMessage,
    defaultStageTimeoutMs: DEFAULT_SETTINGS.stageTimeoutMs,
    voiceProfiles: settingsState.voiceProfiles,
    voiceValidationErrors: settingsState.voiceValidationErrors,
  }
  const settingsPageActions = {
    setSettings: setSettingsData,
    onSave: saveSettings,
    onProbePiper: probePiper,
    onInstallPiper: installPiper,
    onTestTranslateConnectivity: testTranslateConnectivity,
    clearSaveSuccess: () =>
      setSettingsState((prev) => ({
        ...prev,
        saveSuccess: false,
      })),
    clearSaveError: () =>
      setSettingsState((prev) => ({
        ...prev,
        saveError: false,
        saveErrorMessage: '',
      })),
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
    voiceProfiles: settingsState.voiceProfiles,
    isPiperTts: settingsState.data.ttsProvider === 'piper',
    taskFormErrors,
    segments: taskState.segments,
    output: taskState.output,
    ttsAudioUrl: taskState.ttsAudioUrl,
    logs: taskState.logs,
    transcriptContent: taskState.transcriptContent,
    translationContent: taskState.translationContent,
    downloadSpeed: taskState.downloadSpeed,
  }
  const taskPageActions = {
    setTaskForm: setTaskFormData,
    onStartTask: startTask,
    onCancelTask: cancelTask,
    onExportDiagnostics: (taskId: string) => handleExportDiagnostics(taskId),
    onDownloadAudio: handleDownloadAudio,
    onOpenOutputDirectory: handleOpenOutputDirectory,
    onRetrySingleSegment: (segmentId: string) => handleRetryFailedSegments([segmentId]),
  }

  const historyPageModel = {
    historyKeywordDraft: historyState.keywordDraft,
    historyStatusDraft: historyState.statusDraft,
    historyLanguageDraft: historyState.languageDraft,
    historyPageSize: historyState.query.pageSize,
    historyError: historyState.error,
    historyLoading: historyState.loading,
    historyItems: filteredHistoryItems,
    historyRunningTaskId: historyState.runningTaskId,
    historyBusyTaskId: historyState.busyTaskId,
    historyPage: historyState.recoverableOnly ? 1 : historyState.query.page,
    historyTotalPages,
    historyTotal: historyVisibleTotal,
    canPrevPage: !historyState.recoverableOnly && historyState.query.page > 1 && !historyState.loading,
    canNextPage:
      !historyState.recoverableOnly && historyState.query.page < historyTotalPages && !historyState.loading,
    historyRecoverableOnly: historyState.recoverableOnly,
    playingTaskId: playingAudio?.taskId ?? '',
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
    onRecoverableOnlyChange: (value: boolean) =>
      setHistoryState((prev) => ({
        ...prev,
        recoverableOnly: value,
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
    onResumeTask: handleResumeHistoryTask,
    onDownloadArtifacts: handleDownloadHistoryArtifacts,
    onDeleteTask: handleDeleteHistoryTask,
    onPlayAudio: async (taskId: string) => {
      const task = historyState.items.find((item) => item.id === taskId)
      if (!task) return
      const taskDetail = await ipcClient.task.get({ taskId }).catch(() => null)
      const ttsArtifact = taskDetail?.artifacts.find((artifact) => artifact.artifactType === 'tts')
      if (!ttsArtifact) {
        pushLog({ time: new Date().toLocaleTimeString(), stage: 'history', level: 'error', text: '未找到音频文件' })
        return
      }
      const result = await ipcClient.file.readAudio(ttsArtifact.filePath).catch(() => null)
      if (result) {
        const blob = new Blob([result.data], { type: result.mimeType })
        const url = URL.createObjectURL(blob)
        setPlayingAudio((prev) => {
          if (prev?.url) {
            URL.revokeObjectURL(prev.url)
          }
          return { taskId, url, title: task.youtubeTitle || task.youtubeUrl }
        })
      }
    },
    onStopAudio: stopPlayingAudio,
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

          {activeRoute === 'about' && <AboutPage t={t} />}
        </div>
      </div>
      <ConfirmDialog
        open={deleteConfirmDialog.open}
        title={t('history.deleteConfirmTitle')}
        description={t('history.deleteConfirm', { taskId: deleteConfirmDialog.targetTaskId })}
        confirmLabel={t('history.delete')}
        cancelLabel={t('common.cancel')}
        onCancel={() => resolveDeleteConfirm(false)}
        onConfirm={() => resolveDeleteConfirm(true)}
      />
      <ConfirmDialog
        open={resumeConfirmDialog.open}
        title={t('history.resumeOverrideTitle')}
        description={
          t('history.resumeOverrideConfirm', {
            runningTaskId: resumeConfirmDialog.runningTaskId,
            taskId: resumeConfirmDialog.targetTaskId,
          })
        }
        confirmLabel={t('history.resumeOverrideConfirmButton')}
        cancelLabel={t('common.cancel')}
        onCancel={() => resolveResumeOverrideConfirm(false)}
        onConfirm={() => resolveResumeOverrideConfirm(true)}
      />
      {playingAudio && (
        <div className="floating-audio-player" role="region" aria-label={t('history.floatingPlayerAriaLabel')}>
          <div className="floating-audio-header">
            <p className="floating-audio-title" title={playingAudio.title}>
              {playingAudio.title}
            </p>
            <button
              className="floating-audio-close"
              type="button"
              aria-label={t('history.closePlayer')}
              onClick={stopPlayingAudio}
            >
              ×
            </button>
          </div>
          <audio controls autoPlay src={playingAudio.url} />
        </div>
      )}
    </main>
  )
}

export default App
