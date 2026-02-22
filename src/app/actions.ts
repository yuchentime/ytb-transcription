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
import { findLatestArtifactPath, isRunningStatus } from './utils'

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
    const result = await ipcClient.history.list(query)
    setHistoryState((prev) => ({
      ...prev,
      items: result.items,
      total: result.total,
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
    const voiceProfiles = await ipcClient.voices.list().catch(() => [])
    const voiceValidation =
      result.ttsProvider === 'piper'
        ? { valid: true, errors: [] }
        : await ipcClient.voices
          .validateParams({
            voiceId: result.ttsVoiceId,
            speed: result.ttsSpeed,
            pitch: result.ttsPitch,
            volume: result.ttsVolume,
          })
          .catch(() => ({ valid: true, errors: [] }))
    if (!isMounted()) return

    setSettingsState((prev) => ({
      ...prev,
      data: result,
      voiceProfiles,
      voiceValidationErrors: voiceValidation.errors,
    }))
    setTaskState((prev) => ({
      ...prev,
      form: {
        ...prev.form,
        targetLanguage: result.defaultTargetLanguage,
        ttsVoiceId: result.ttsVoiceId,
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
    const saved = await ipcClient.settings.update(settings)
    const voiceValidation =
      saved.ttsProvider === 'piper'
        ? { valid: true, errors: [] }
        : await ipcClient.voices
          .validateParams({
            voiceId: saved.ttsVoiceId,
            speed: saved.ttsSpeed,
            pitch: saved.ttsPitch,
            volume: saved.ttsVolume,
          })
          .catch(() => ({ valid: true, errors: [] }))
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
        targetLanguage: saved.defaultTargetLanguage,
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
): Promise<void> {
  const { taskForm, settings, ipcClient, setTaskState, setActiveRoute, refreshHistory, historyQuery, t } = params

  if (!taskForm.youtubeUrl.trim()) return

  setTaskState((prev) => ({
    ...prev,
    error: '',
    output: {},
    stageProgress: {},
    segments: [],
    recoveryActions: [],
    logs: [],
    transcriptContent: undefined,
    translationContent: undefined,
  }))

  try {
    if (settings.ttsProvider !== 'piper') {
      const voiceValidation = await ipcClient.voices.validateParams({
        voiceId: taskForm.ttsVoiceId,
        speed: settings.ttsSpeed,
        pitch: settings.ttsPitch,
        volume: settings.ttsVolume,
      })
      if (!voiceValidation.valid) {
        throw new Error(voiceValidation.errors.join('；') || 'TTS 参数不合法')
      }
    }

    const task = await ipcClient.task.create({
      youtubeUrl: taskForm.youtubeUrl.trim(),
      targetLanguage: taskForm.targetLanguage,
      whisperModel: settings.defaultWhisperModel,
      translateProvider: settings.translateProvider,
      ttsProvider: settings.ttsProvider,
      translateModelId: settings.translateModelId,
      ttsModelId: settings.ttsModelId,
      ttsVoice: taskForm.ttsVoiceId,
      modelConfigSnapshot: {
        translateProvider: settings.translateProvider,
        ttsProvider: settings.ttsProvider,
        minimaxApiBaseUrl: settings.minimaxApiBaseUrl,
        deepseekApiBaseUrl: settings.deepseekApiBaseUrl,
        glmApiBaseUrl: settings.glmApiBaseUrl,
        kimiApiBaseUrl: settings.kimiApiBaseUrl,
        customApiBaseUrl: settings.customApiBaseUrl,
        segmentationStrategy: taskForm.segmentationStrategy,
        segmentationOptions: {
          maxCharsPerSegment: 900,
          targetDurationSec: taskForm.segmentationTargetDurationSec,
        },
        translationContextChars: 160,
        translateRequestTimeoutMs: 120000,
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
        ttsSpeed: settings.ttsSpeed,
        ttsPitch: settings.ttsPitch,
        ttsVolume: settings.ttsVolume,
        piperExecutablePath: settings.piperExecutablePath,
        piperModelPath: settings.piperModelPath,
        piperConfigPath: settings.piperConfigPath,
        piperSpeakerId: settings.piperSpeakerId,
        piperLengthScale: settings.piperLengthScale,
        piperNoiseScale: settings.piperNoiseScale,
        piperNoiseW: settings.piperNoiseW,
      },
    })

    setTaskState((prev) => ({
      ...prev,
      activeTaskId: task.id,
      activeStatus: task.status,
      segments: [],
      recoveryActions: [],
    }))

    const result = await ipcClient.task.start({ taskId: task.id })
    if (!result.accepted) {
      throw new Error(result.reason ?? t('error.taskNotAccepted'))
    }

    setTaskState((prev) => ({
      ...prev,
      running: true,
    }))
    setActiveRoute('task')
    void refreshHistory(historyQuery)
  } catch (error) {
    setTaskState((prev) => ({
      ...prev,
      error: getErrorMessage(error, t('error.startTask')),
    }))
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
  if (!activeTaskId) return

  try {
    await ipcClient.task.cancel({ taskId: activeTaskId })
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

export async function handleExportDiagnosticsAction(
  params: {
    taskId?: string
    ipcClient: RendererAPI
  } & LogDeps &
    LocalizedDeps,
): Promise<void> {
  const { taskId, ipcClient, pushLog, t } = params

  try {
    const result = await ipcClient.system.exportDiagnostics(taskId ? { taskId } : undefined)
    pushLog({
      time: new Date().toISOString(),
      stage: 'system',
      level: 'info',
      text: t('log.diagnosticsExported', { filePath: result.filePath }),
    })
    await ipcClient.system.openPath({ path: result.filePath })
  } catch (error) {
    pushLog({
      time: new Date().toISOString(),
      stage: 'system',
      level: 'error',
      text: t('error.exportDiagnostics', { message: toUnknownErrorMessage(error) }),
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
