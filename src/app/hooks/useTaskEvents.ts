import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { RendererAPI, TaskRuntimeEventPayload, TaskStatusEventPayload } from '../../../electron/ipc/channels'
import type { TranslateFn } from '../i18n'
import { translateTaskStatus } from '../i18n'
import { loadTaskContentAction } from '../actions'
import type { HistoryQueryState, LogItem, TaskState } from '../state'
import { isRunningStatus } from '../utils'

interface UseTaskEventsOptions {
  ipcClient: RendererAPI
  activeTaskId: string
  historyQuery: HistoryQueryState
  setTaskState: Dispatch<SetStateAction<TaskState>>
  pushLog(item: Omit<LogItem, 'id'>): void
  refreshHistory(query: HistoryQueryState): Promise<void>
  t: TranslateFn
  onTaskStatus?(payload: TaskStatusEventPayload): void
}

export function useTaskEvents(options: UseTaskEventsOptions): void {
  const { ipcClient, activeTaskId, historyQuery, setTaskState, pushLog, refreshHistory, t, onTaskStatus } = options

  useEffect(() => {
    let historyRefreshTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleHistoryRefresh = (): void => {
      if (historyRefreshTimer) {
        clearTimeout(historyRefreshTimer)
      }
      historyRefreshTimer = setTimeout(() => {
        void refreshHistory(historyQuery)
      }, 120)
    }

    const formatRecoveryActionsLog = (
      actions: Array<{ label: string; reason: string }>,
    ): string => {
      if (actions.length === 0) return '未生成恢复建议'
      return actions
        .slice(0, 3)
        .map((action, index) => `${index + 1}. ${action.label}：${action.reason}`)
        .join(' | ')
    }

    const refreshSegmentsAndRecovery = async (taskId: string): Promise<void> => {
      try {
        const [segments, recoveryPlan] = await Promise.all([
          ipcClient.task.segments({ taskId }),
          ipcClient.task
            .recoveryPlan({ taskId })
            .catch(() => ({ taskId, fromStage: null, failedSegments: [], actions: [] })),
        ])

        setTaskState((prev) => ({
          ...prev,
          segments,
          recoveryActions: recoveryPlan.actions,
        }))
      } catch {
        // Ignore refresh failures to avoid interrupting task status updates.
      }
    }

    const offStatus = ipcClient.task.onStatus((payload) => {
      onTaskStatus?.(payload)
      scheduleHistoryRefresh()
      if (payload.taskId !== activeTaskId && activeTaskId) return
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
        text: t('log.statusChanged', { status: translateTaskStatus(payload.status, t) }),
      })
    })

    const offProgress = ipcClient.task.onProgress((payload) => {
      if (payload.taskId !== activeTaskId && activeTaskId) return
      setTaskState((prev) => ({
        ...prev,
        activeTaskId: payload.taskId,
        stageProgress: {
          ...prev.stageProgress,
          [payload.stage]: payload.percent,
        },
        // 更新下载速度（仅在 downloading 阶段）
        downloadSpeed: payload.stage === 'downloading' ? payload.speed : prev.downloadSpeed,
      }))
    })

    const offSegmentProgress = ipcClient.task.onSegmentProgress((payload) => {
      if (payload.taskId !== activeTaskId && activeTaskId) return
      setTaskState((prev) => ({
        ...prev,
        stageProgress: {
          ...prev.stageProgress,
          [payload.stage]: payload.percent,
        },
      }))
      void refreshSegmentsAndRecovery(payload.taskId)
    })

    const offSegmentFailed = ipcClient.task.onSegmentFailed((payload) => {
      if (payload.taskId !== activeTaskId && activeTaskId) return
      pushLog({
        time: new Date().toISOString(),
        stage: payload.stage,
        level: 'error',
        text: `${payload.errorCode}: ${payload.errorMessage}`,
      })
      void refreshSegmentsAndRecovery(payload.taskId)
    })

    const offRecoverySuggested = ipcClient.task.onRecoverySuggested((payload) => {
      if (payload.taskId !== activeTaskId && activeTaskId) return
      setTaskState((prev) => ({
        ...prev,
        activeTaskId: prev.activeTaskId || payload.taskId,
        recoveryActions: payload.actions,
      }))
      pushLog({
        time: new Date().toISOString(),
        stage: 'recovery',
        level: 'warn',
        text: `恢复建议：${formatRecoveryActionsLog(payload.actions)}`,
      })
      void refreshSegmentsAndRecovery(payload.taskId)
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
      scheduleHistoryRefresh()
      if (payload.taskId !== activeTaskId && activeTaskId) return
      setTaskState((prev) => ({
        ...prev,
        running: false,
        error: '',
        output: payload.output,
      }))
      void loadTaskContentAction({
        ipcClient,
        setTaskState,
        transcriptPath: payload.output.transcriptPath,
        translationPath: payload.output.translationPath,
        pushLog,
      })

      pushLog({
        time: new Date().toISOString(),
        stage: 'completed',
        level: 'info',
        text: t('log.taskCompleted'),
      })
      void refreshSegmentsAndRecovery(payload.taskId)
    })

    const offFailed = ipcClient.task.onFailed((payload) => {
      scheduleHistoryRefresh()
      if (payload.taskId !== activeTaskId && activeTaskId) return
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
      void refreshSegmentsAndRecovery(payload.taskId)
    })

    // Handle runtime events - show modal when components are being prepared
    const offRuntime = ipcClient.task.onRuntime((payload) => {
      if (payload.taskId !== activeTaskId && activeTaskId) return
      setTaskState((prev) => {
        // Update component status
        const updatedStatus: Record<string, TaskRuntimeEventPayload> = {
          ...prev.runtimeComponentStatus,
          [payload.component]: payload,
        }

        // Determine if modal should be visible
        // Show modal if any component is in checking/downloading/installing state
        const hasActiveWork = Object.values(updatedStatus).some(
          (event) => event.status === 'checking' || event.status === 'downloading' || event.status === 'installing'
        )

        return {
          ...prev,
          runtimeComponentStatus: updatedStatus,
          // Show modal when there's active work and we're in early stages
          isRuntimeModalVisible: hasActiveWork,
        }
      })
    })

    return () => {
      if (historyRefreshTimer) {
        clearTimeout(historyRefreshTimer)
      }
      offStatus()
      offProgress()
      offSegmentProgress()
      offSegmentFailed()
      offRecoverySuggested()
      offLog()
      offCompleted()
      offFailed()
      offRuntime()
    }
  }, [activeTaskId, historyQuery, ipcClient, onTaskStatus, pushLog, refreshHistory, setTaskState, t])
}
