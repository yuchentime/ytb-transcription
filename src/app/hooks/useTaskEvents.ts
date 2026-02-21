import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { RendererAPI } from '../../../electron/ipc/channels'
import type { TranslateFn } from '../i18n'
import { translateTaskStatus } from '../i18n'
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
}

export function useTaskEvents(options: UseTaskEventsOptions): void {
  const { ipcClient, activeTaskId, historyQuery, setTaskState, pushLog, refreshHistory, t } = options

  useEffect(() => {
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

    const offRuntime = ipcClient.task.onRuntime((payload) => {
      if (payload.taskId !== activeTaskId && activeTaskId) return
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
        text: t('log.taskCompleted'),
      })
      void refreshSegmentsAndRecovery(payload.taskId)
      void refreshHistory(historyQuery)
    })

    const offFailed = ipcClient.task.onFailed((payload) => {
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
      void refreshHistory(historyQuery)
    })

    return () => {
      offStatus()
      offProgress()
      offSegmentProgress()
      offSegmentFailed()
      offRecoverySuggested()
      offRuntime()
      offLog()
      offCompleted()
      offFailed()
    }
  }, [activeTaskId, historyQuery, ipcClient, pushLog, refreshHistory, setTaskState, t])
}
