import type { Dispatch, SetStateAction } from 'react'
import type { AppSettings } from '../../electron/core/db/types'
import type { RendererAPI } from '../../electron/ipc/channels'
import type { TranslateFn } from './i18n'
import type {
  HistoryQueryState,
  HistoryState,
  LogItem,
  SettingsState,
  TaskFormState,
  TaskOutput,
  TaskState,
} from './state'
import type { AppRoute } from './router'
import { findLatestArtifactPath, isRunningStatus, isValidYoutubeUrl } from './utils'

interface LocalizedDeps {
  t: TranslateFn
}

interface CommonTaskActionDeps {
  ipcClient: RendererAPI
  setTaskState: Dispatch<SetStateAction<TaskState>>
}

interface LogDeps {
  pushLog(item: Omit<LogItem, 'id'>): void
}

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  return error instanceof Error ? error.message : fallbackMessage
}

function toUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeSettingsTtsProvider(settings: AppSettings): AppSettings {
  if (settings.ttsProvider !== 'piper') {
    return settings
  }
  return {
    ...settings,
    ttsProvider: 'minimax',
  }
}

function shouldValidateVoicePreset(settings: AppSettings): boolean {
  return settings.ttsProvider === 'minimax'
}

export async function loadHistoryAction(
  params: {
    ipcClient: RendererAPI
    setHistoryState: Dispatch<SetStateAction<HistoryState>>
    query: HistoryQueryState
  } & LocalizedDeps,
): Promise<void> {
  const { ipcClient, setHistoryState, query, t } = params

  setHistoryState((prev) => ({
    ...prev,
    loading: true,
    error: '',
  }))

  try {
    const [result, queueSnapshot, runningTask] = await Promise.all([
      ipcClient.history.list(query),
      ipcClient.queue.list().catch(() => null),
      ipcClient.task.getRunning().catch(() => null),
    ])
    const runningTaskId = runningTask?.id ?? queueSnapshot?.running[0]?.taskId ?? ''
    setHistoryState((prev) => ({
      ...prev,
      items: result.items,
      total: result.total,
      runningTaskId,
      loading: false,
    }))
  } catch (error) {
    setHistoryState((prev) => ({
      ...prev,
      error: getErrorMessage(error, t('error.loadHistory')),
      loading: false,
    }))
  }
}

export async function loadTaskDetailAction(
  params: CommonTaskActionDeps &
    LogDeps &
    LocalizedDeps & {
      setActiveRoute: Dispatch<SetStateAction<AppRoute>>
      taskId: string
    },
): Promise<void> {
  const { ipcClient, setTaskState, setActiveRoute, pushLog, taskId, t } = params

  try {
    const detail = await ipcClient.task.get({ taskId })
    const recoveryPlan = await ipcClient.task
      .recoveryPlan({ taskId })
      .catch(() => ({ taskId, fromStage: null, failedSegments: [], actions: [] }))
    const progress: Record<string, number> = {}
    for (const step of detail.steps) {
      if (step.status === 'success') {
        progress[step.stepName] = 100
      } else if (step.status === 'running') {
        progress[step.stepName] = 50
      } else if (step.status === 'failed') {
        progress[step.stepName] = 100
      }
    }

    setTaskState((prev) => ({
      ...prev,
      activeTaskId: taskId,
      activeStatus: detail.task.status,
      running: isRunningStatus(detail.task.status),
      error: detail.task.errorMessage ?? '',
      processingYoutubeUrl: detail.task.youtubeUrl,
      processingYoutubeTitle: detail.task.youtubeTitle || detail.task.youtubeUrl,
      stageProgress: progress,
      segments: detail.segments,
      recoveryActions: recoveryPlan.actions,
      output: {
        transcriptPath: findLatestArtifactPath(detail.artifacts, 'transcript'),
        translationPath: findLatestArtifactPath(detail.artifacts, 'translation'),
        ttsPath: findLatestArtifactPath(detail.artifacts, 'tts'),
      },
      transcriptContent: undefined,
      translationContent: undefined,
      runtimeComponentStatus: {},
      isRuntimeModalVisible: false,
    }))
    // Load transcript and translation content if available (before routing)
    const transcriptPath = findLatestArtifactPath(detail.artifacts, 'transcript')
    const translationPath = findLatestArtifactPath(detail.artifacts, 'translation')

    if (transcriptPath || translationPath) {
      await loadTaskContentAction({
        ipcClient,
        setTaskState,
        transcriptPath,
        translationPath,
        pushLog,
      })
    }

    setActiveRoute('task')

    pushLog({
      time: new Date().toISOString(),
      stage: 'history',
      level: 'info',
      text: t('log.loadedTaskDetail', { taskId }),
    })
  } catch (error) {
    setTaskState((prev) => ({
      ...prev,
      error: getErrorMessage(error, t('error.loadTaskDetail')),
    }))
  }
}

export async function loadSettingsAction(
  params: {
    ipcClient: RendererAPI
    setSettingsState: Dispatch<SetStateAction<SettingsState>>
    setTaskState: Dispatch<SetStateAction<TaskState>>
    isMounted(): boolean
  } & LocalizedDeps,
): Promise<void> {
  const { ipcClient, setSettingsState, setTaskState, isMounted, t } = params

  setSettingsState((prev) => ({
    ...prev,
    loading: true,
    error: '',
  }))

  try {
    const result = await ipcClient.settings.get()
    const normalizedSettings = normalizeSettingsTtsProvider(result)
    const voiceProfiles = await ipcClient.voices.list().catch(() => [])
    const voiceValidation = shouldValidateVoicePreset(normalizedSettings)
      ? await ipcClient.voices
          .validateParams({
            voiceId: normalizedSettings.ttsVoiceId,
            speed: normalizedSettings.ttsSpeed,
            pitch: normalizedSettings.ttsPitch,
            volume: normalizedSettings.ttsVolume,
          })
          .catch(() => ({ valid: true, errors: [] }))
      : { valid: true, errors: [] }
    if (normalizedSettings !== result) {
      await ipcClient.settings.update({
        ttsProvider: 'minimax',
      }).catch(() => undefined)
    }
    if (!isMounted()) return

    setSettingsState((prev) => ({
      ...prev,
      data: normalizedSettings,
      voiceProfiles,
      voiceValidationErrors: voiceValidation.errors,
    }))
    setTaskState((prev) => ({
      ...prev,
      form: {
        ...prev.form,
        targetLanguage: normalizedSettings.ttsTargetLanguage ?? 'zh',
        ttsVoiceId: normalizedSettings.ttsVoiceId,
      },
    }))
  } catch (error) {
    if (!isMounted()) return
    setSettingsState((prev) => ({
      ...prev,
      error: getErrorMessage(error, t('error.loadSettings')),
    }))
  } finally {
    if (isMounted()) {
      setSettingsState((prev) => ({
        ...prev,
        loading: false,
      }))
    }
  }
}

export async function saveSettingsAction(
  params: {
    settings: AppSettings
    ipcClient: RendererAPI
    setSettingsState: Dispatch<SetStateAction<SettingsState>>
    setTaskState: Dispatch<SetStateAction<TaskState>>
  } & LogDeps &
    LocalizedDeps,
): Promise<void> {
  const { settings, ipcClient, setSettingsState, setTaskState, pushLog, t } = params

  setSettingsState((prev) => ({
    ...prev,
    saving: true,
    error: '',
    saveSuccess: false,
    saveError: false,
  }))

  try {
    const payload = normalizeSettingsTtsProvider(settings)
    const saved = await ipcClient.settings.update(payload)
    const voiceValidation = shouldValidateVoicePreset(saved)
      ? await ipcClient.voices
          .validateParams({
            voiceId: saved.ttsVoiceId,
            speed: saved.ttsSpeed,
            pitch: saved.ttsPitch,
            volume: saved.ttsVolume,
          })
          .catch(() => ({ valid: true, errors: [] }))
      : { valid: true, errors: [] }
    setSettingsState((prev) => ({
      ...prev,
      data: saved,
      saveSuccess: true,
      voiceValidationErrors: voiceValidation.errors,
    }))
    setTaskState((prev) => ({
      ...prev,
      form: {
        ...prev.form,
        targetLanguage: saved.ttsTargetLanguage ?? 'zh',
        ttsVoiceId: saved.ttsVoiceId,
      },
    }))

    pushLog({
      time: new Date().toISOString(),
      stage: 'settings',
      level: 'info',
      text: t('log.settingsSaved'),
    })

    // 自动清除成功状态（3秒后）
    setTimeout(() => {
      setSettingsState((prev) => ({
        ...prev,
        saveSuccess: false,
      }))
    }, 3000)
  } catch (error) {
    const errorMessage = getErrorMessage(error, t('error.saveSettings'))
    setSettingsState((prev) => ({
      ...prev,
      error: errorMessage,
      saveError: true,
      saveErrorMessage: errorMessage,
    }))

    // 自动清除错误状态（3秒后）
    setTimeout(() => {
      setSettingsState((prev) => ({
        ...prev,
        saveError: false,
        saveErrorMessage: '',
      }))
    }, 3000)
  } finally {
    setSettingsState((prev) => ({
      ...prev,
      saving: false,
    }))
  }
}

export async function startTaskAction(
  params: CommonTaskActionDeps &
    LocalizedDeps & {
      taskForm: TaskFormState
      settings: AppSettings
      setActiveRoute: Dispatch<SetStateAction<AppRoute>>
      refreshHistory(query: HistoryQueryState): Promise<void>
      historyQuery: HistoryQueryState
    },
): Promise<boolean> {
  const { taskForm, settings, ipcClient, setTaskState, setActiveRoute, refreshHistory, historyQuery, t } = params

  const youtubeUrl = taskForm.youtubeUrl.trim()
  if (!youtubeUrl || !isValidYoutubeUrl(youtubeUrl)) {
    setTaskState((prev) => ({
      ...prev,
      error: t('validation.youtubeUrlRequired'),
    }))
    return false
  }

  setTaskState((prev) => ({
    ...prev,
    error: '',
  }))

  if (!settings.translateModelId.trim()) {
    setTaskState((prev) => ({
      ...prev,
      error: t('validation.translateModelRequired'),
    }))
    return false
  }

  if (!settings.ttsModelId.trim()) {
    setTaskState((prev) => ({
      ...prev,
      error: t('validation.ttsModelRequired'),
    }))
    return false
  }

  try {
    const runtimeSettings = normalizeSettingsTtsProvider(settings)

    if (shouldValidateVoicePreset(runtimeSettings)) {
      const voiceValidation = await ipcClient.voices.validateParams({
        voiceId: taskForm.ttsVoiceId,
        speed: runtimeSettings.ttsSpeed,
        pitch: runtimeSettings.ttsPitch,
        volume: runtimeSettings.ttsVolume,
      })
      if (!voiceValidation.valid) {
        throw new Error(voiceValidation.errors.join('；') || 'TTS 参数不合法')
      }
    }

    const createResult = await ipcClient.batch.create({
      urls: [youtubeUrl],
      sharedConfig: {
        targetLanguage: taskForm.targetLanguage,
        whisperModel: runtimeSettings.defaultWhisperModel,
        translateProvider: runtimeSettings.translateProvider,
        ttsProvider: runtimeSettings.ttsProvider,
        translateModelId: runtimeSettings.translateModelId,
        ttsModelId: runtimeSettings.ttsModelId,
        ttsVoice: taskForm.ttsVoiceId,
        modelConfigSnapshot: {
          translateProvider: runtimeSettings.translateProvider,
          ttsProvider: runtimeSettings.ttsProvider,
          minimaxApiBaseUrl: runtimeSettings.minimaxApiBaseUrl,
          deepseekApiBaseUrl: runtimeSettings.deepseekApiBaseUrl,
          glmApiBaseUrl: runtimeSettings.glmApiBaseUrl,
          openaiApiBaseUrl: runtimeSettings.openaiApiBaseUrl,
          qwenApiBaseUrl: runtimeSettings.qwenApiBaseUrl,
          kimiApiBaseUrl: runtimeSettings.kimiApiBaseUrl,
          customApiBaseUrl: runtimeSettings.customApiBaseUrl,
          segmentationStrategy: 'punctuation',
          segmentationOptions: {
            maxCharsPerSegment: 900,
          },
          translationContextChars: 160,
          translateRequestTimeoutMs: 120000,
          translateSplitThresholdTokens: 8000,
          autoPolishLongText: true,
          polishMinDurationSec: 600,
          polishContextChars: 180,
          polishTargetSegmentLength: 900,
          transcribeChunkEnabled: true,
          transcribeChunkMinDurationSec: 600,
          transcribeChunkDurationSec: 240,
          transcribeChunkOverlapSec: 1.2,
          transcribeConcurrency: 2,
          ttsSplitThresholdChars: 3000,
          ttsTargetSegmentChars: 900,
          ttsVoiceId: taskForm.ttsVoiceId,
          ttsSpeed: runtimeSettings.ttsSpeed,
          ttsPitch: runtimeSettings.ttsPitch,
          ttsVolume: runtimeSettings.ttsVolume,
        },
      },
    })

    if (createResult.accepted <= 0 || createResult.taskIds.length === 0) {
      const firstRejected = createResult.rejectedItems[0]
      throw new Error(firstRejected?.reason ?? t('error.taskNotAccepted'))
    }

    setTaskState((prev) => ({
      ...prev,
      activeTaskId: prev.running ? prev.activeTaskId : createResult.taskIds[0],
      activeStatus: prev.running ? prev.activeStatus : 'queued',
      processingYoutubeUrl: prev.running ? prev.processingYoutubeUrl : youtubeUrl,
      processingYoutubeTitle: prev.running ? prev.processingYoutubeTitle : youtubeUrl,
      stageProgress: prev.running ? prev.stageProgress : {},
      segments: prev.running ? prev.segments : [],
      recoveryActions: prev.running ? prev.recoveryActions : [],
      output: prev.running ? prev.output : {},
      ttsAudioUrl: prev.running ? prev.ttsAudioUrl : '',
      transcriptContent: prev.running ? prev.transcriptContent : undefined,
      translationContent: prev.running ? prev.translationContent : undefined,
      downloadSpeed: prev.running ? prev.downloadSpeed : undefined,
      runtimeComponentStatus: prev.running ? prev.runtimeComponentStatus : {},
      isRuntimeModalVisible: prev.running ? prev.isRuntimeModalVisible : false,
      form: {
        ...prev.form,
        youtubeUrl: '',
      },
    }))

    setActiveRoute('task')
    void refreshHistory(historyQuery)
    return true
  } catch (error) {
    setTaskState((prev) => ({
      ...prev,
      error: getErrorMessage(error, t('error.startTask')),
    }))
    return false
  }
}

export async function cancelTaskAction(
  params: {
    activeTaskId: string
    ipcClient: RendererAPI
    setTaskState: Dispatch<SetStateAction<TaskState>>
  } & LocalizedDeps,
): Promise<void> {
  const { activeTaskId, ipcClient, setTaskState, t } = params
  const directTaskId = activeTaskId.trim()

  try {
    const runningTask = await ipcClient.task.getRunning().catch(() => null)
    const preferredTaskId = directTaskId || runningTask?.id || ''
    if (!preferredTaskId) {
      throw new Error(t('error.cancelTask'))
    }

    let canceled = false
    let canceledTaskId = preferredTaskId

    const directResult = await ipcClient.task.cancel({ taskId: preferredTaskId })
    canceled = directResult.canceled

    if (!canceled && runningTask && runningTask.id !== preferredTaskId) {
      const fallbackResult = await ipcClient.task.cancel({ taskId: runningTask.id })
      canceled = fallbackResult.canceled
      canceledTaskId = runningTask.id
    }

    if (!canceled) {
      throw new Error(t('error.cancelTask'))
    }

    setTaskState((prev) => ({
      ...prev,
      activeTaskId: canceledTaskId,
      error: '',
    }))
  } catch (error) {
    setTaskState((prev) => ({
      ...prev,
      error: getErrorMessage(error, t('error.cancelTask')),
    }))
  }
}

export async function retryFailedSegmentsAction(
  params: {
    activeTaskId: string
    ipcClient: RendererAPI
    setTaskState: Dispatch<SetStateAction<TaskState>>
    segmentIds?: string[]
  } & LogDeps &
    LocalizedDeps,
): Promise<void> {
  const { activeTaskId, ipcClient, setTaskState, segmentIds, pushLog, t } = params
  if (!activeTaskId) return

  try {
    const ids = segmentIds && segmentIds.length > 0 ? segmentIds : undefined
    const segments = ids
      ? ids
      : (await ipcClient.task.segments({ taskId: activeTaskId }))
          .filter((segment) => segment.status === 'failed')
          .map((segment) => segment.id)

    if (segments.length === 0) {
      pushLog({
        time: new Date().toISOString(),
        stage: 'recovery',
        level: 'warn',
        text: '没有可重试的失败分段',
      })
      return
    }

    const result = await ipcClient.task.retrySegments({
      taskId: activeTaskId,
      segmentIds: segments,
    })
    if (!result.accepted) {
      throw new Error(result.reason ?? t('error.retryNotAccepted'))
    }

    setTaskState((prev) => ({
      ...prev,
      running: true,
      error: '',
      recoveryActions: [],
    }))
    pushLog({
      time: new Date().toISOString(),
      stage: 'recovery',
      level: 'info',
      text: `已发起分段重试（${segments.length} 段）`,
    })
  } catch (error) {
    setTaskState((prev) => ({
      ...prev,
      error: getErrorMessage(error, t('error.retryTask')),
    }))
  }
}

export async function resumeTaskFromCheckpointAction(
  params: {
    activeTaskId: string
    ipcClient: RendererAPI
    setTaskState: Dispatch<SetStateAction<TaskState>>
  } & LogDeps &
    LocalizedDeps,
): Promise<void> {
  const { activeTaskId, ipcClient, setTaskState, pushLog, t } = params
  if (!activeTaskId) return

  try {
    const result = await ipcClient.task.resumeFromCheckpoint({ taskId: activeTaskId })
    if (!result.accepted) {
      throw new Error(result.reason ?? t('error.retryNotAccepted'))
    }
    setTaskState((prev) => ({
      ...prev,
      running: true,
      error: '',
      recoveryActions: [],
    }))
    pushLog({
      time: new Date().toISOString(),
      stage: 'recovery',
      level: 'info',
      text: `从检查点恢复：${result.fromStage}`,
    })
  } catch (error) {
    setTaskState((prev) => ({
      ...prev,
      error: getErrorMessage(error, t('error.retryTask')),
    }))
  }
}

export async function handleDownloadAudioAction(
  params: {
    ttsPath?: string
    ipcClient: RendererAPI
  } & LogDeps &
    LocalizedDeps,
): Promise<void> {
  const { ttsPath, ipcClient, pushLog, t } = params
  if (!ttsPath) return

  try {
    const { data, mimeType, fileName } = await ipcClient.file.readAudio(ttsPath)
    const blob = new Blob([data], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  } catch (error) {
    pushLog({
      time: new Date().toISOString(),
      stage: 'tts',
      level: 'error',
      text: t('error.downloadAudio', { message: toUnknownErrorMessage(error) }),
    })
  }
}

export async function handleOpenOutputDirectoryAction(
  params: {
    output: TaskOutput
    ipcClient: RendererAPI
  } & LogDeps &
    LocalizedDeps,
): Promise<void> {
  const { output, ipcClient, pushLog, t } = params
  const targetPath = output.ttsPath ?? output.transcriptPath ?? output.translationPath
  if (!targetPath) return

  try {
    await ipcClient.system.openPath({ path: targetPath })
  } catch (error) {
    pushLog({
      time: new Date().toISOString(),
      stage: 'system',
      level: 'error',
      text: t('error.openPath', { message: toUnknownErrorMessage(error) }),
    })
  }
}

export function applyHistoryFiltersAction(params: {
  setHistoryState: Dispatch<SetStateAction<HistoryState>>
}): void {
  const { setHistoryState } = params

  setHistoryState((prev) => ({
    ...prev,
    query: {
      ...prev.query,
      page: 1,
      status: prev.statusDraft === 'all' ? undefined : prev.statusDraft,
      targetLanguage: prev.languageDraft === 'all' ? undefined : prev.languageDraft,
      keyword: prev.keywordDraft.trim() ? prev.keywordDraft.trim() : undefined,
    },
  }))
}

export async function handleDeleteHistoryTaskAction(
  params: {
    taskId: string
    activeTaskId: string
    historyQuery: HistoryQueryState
    confirmDelete(taskId: string): boolean
    refreshHistory(query: HistoryQueryState): Promise<void>
    ipcClient: RendererAPI
    setHistoryState: Dispatch<SetStateAction<HistoryState>>
    setTaskState: Dispatch<SetStateAction<TaskState>>
  } & LogDeps &
    LocalizedDeps,
): Promise<void> {
  const {
    taskId,
    activeTaskId,
    historyQuery,
    confirmDelete,
    refreshHistory,
    ipcClient,
    setHistoryState,
    setTaskState,
    pushLog,
    t,
  } = params

  if (!confirmDelete(taskId)) return

  setHistoryState((prev) => ({
    ...prev,
    busyTaskId: taskId,
    error: '',
  }))

  try {
    const result = await ipcClient.history.delete({ taskId })
    if (!result.deleted) {
      throw new Error(t('error.taskNotDeleted'))
    }

    if (activeTaskId === taskId) {
      setTaskState((prev) => ({
        ...prev,
        activeTaskId: '',
        activeStatus: '',
        running: false,
        processingYoutubeUrl: '',
        processingYoutubeTitle: '',
        output: {},
        transcriptContent: undefined,
        translationContent: undefined,
      }))
    }

    pushLog({
      time: new Date().toISOString(),
      stage: 'history',
      level: 'info',
      text: t('log.deletedTask', { taskId }),
    })

    await refreshHistory(historyQuery)
  } catch (error) {
    setHistoryState((prev) => ({
      ...prev,
      error: getErrorMessage(error, t('error.deleteTask')),
    }))
  } finally {
    setHistoryState((prev) => ({
      ...prev,
      busyTaskId: '',
    }))
  }
}

export async function loadTaskContentAction(
  params: {
    ipcClient: RendererAPI
    setTaskState: Dispatch<SetStateAction<TaskState>>
    transcriptPath?: string
    translationPath?: string
  } & LogDeps,
): Promise<void> {
  const { ipcClient, setTaskState, transcriptPath, translationPath, pushLog } = params

  setTaskState((prev) => ({
    ...prev,
    transcriptContent: transcriptPath ? prev.transcriptContent : undefined,
    translationContent: translationPath ? prev.translationContent : undefined,
  }))

  if (transcriptPath) {
    try {
      const result = await ipcClient.file.readText(transcriptPath)
      setTaskState((prev) => ({
        ...prev,
        transcriptContent: result.content,
      }))
    } catch (error) {
      setTaskState((prev) => ({
        ...prev,
        transcriptContent: undefined,
      }))
      pushLog({
        time: new Date().toISOString(),
        stage: 'transcript',
        level: 'warn',
        text: `Failed to load transcript: ${toUnknownErrorMessage(error)}`,
      })
    }
  }

  if (translationPath) {
    try {
      const result = await ipcClient.file.readText(translationPath)
      setTaskState((prev) => ({
        ...prev,
        translationContent: result.content,
      }))
    } catch (error) {
      setTaskState((prev) => ({
        ...prev,
        translationContent: undefined,
      }))
      pushLog({
        time: new Date().toISOString(),
        stage: 'translation',
        level: 'warn',
        text: `Failed to load translation: ${toUnknownErrorMessage(error)}`,
      })
    }
  }
}

export async function handleRetryHistoryTaskAction(
  params: {
    taskId: string
    historyQuery: HistoryQueryState
    refreshHistory(query: HistoryQueryState): Promise<void>
    setActiveRoute: Dispatch<SetStateAction<AppRoute>>
    ipcClient: RendererAPI
    setHistoryState: Dispatch<SetStateAction<HistoryState>>
    setTaskState: Dispatch<SetStateAction<TaskState>>
  } & LogDeps &
    LocalizedDeps,
): Promise<void> {
  const {
    taskId,
    historyQuery,
    refreshHistory,
    setActiveRoute,
    ipcClient,
    setHistoryState,
    setTaskState,
    pushLog,
    t,
  } = params

  setHistoryState((prev) => ({
    ...prev,
    busyTaskId: taskId,
  }))
  setTaskState((prev) => ({
    ...prev,
    error: '',
  }))

  try {
    const result = await ipcClient.task.retry({ taskId })
    if (!result.accepted) {
      throw new Error(result.reason ?? t('error.retryNotAccepted'))
    }

    setTaskState((prev) => ({
      ...prev,
      activeTaskId: taskId,
      running: true,
      error: '',
      output: {},
      stageProgress: {},
      segments: [],
      recoveryActions: [],
      logs: [],
      transcriptContent: undefined,
      translationContent: undefined,
      downloadSpeed: undefined,
    }))
    setActiveRoute('task')

    pushLog({
      time: new Date().toISOString(),
      stage: 'history',
      level: 'info',
      text: t('log.retryRequested', { taskId }),
    })
  } catch (error) {
    setHistoryState((prev) => ({
      ...prev,
      error: getErrorMessage(error, t('error.retryTask')),
    }))
  } finally {
    setHistoryState((prev) => ({
      ...prev,
      busyTaskId: '',
    }))
    await refreshHistory(historyQuery)
  }
}
