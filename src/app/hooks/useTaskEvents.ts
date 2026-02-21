import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { RendererAPI } from '../../../electron/ipc/channels'
import type { HistoryQueryState, LogItem, TaskState } from '../state'
import { isRunningStatus } from '../utils'

interface UseTaskEventsOptions {
  ipcClient: RendererAPI
  activeTaskId: string
  historyQuery: HistoryQueryState
  setTaskState: Dispatch<SetStateAction<TaskState>>
  pushLog(item: Omit<LogItem, 'id'>): void
  refreshHistory(query: HistoryQueryState): Promise<void>
}

export function useTaskEvents(options: UseTaskEventsOptions): void {
  const { ipcClient, activeTaskId, historyQuery, setTaskState, pushLog, refreshHistory } = options

  useEffect(() => {
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
        text: `Status -> ${payload.status}`,
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
        text: 'Task completed',
      })
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
      void refreshHistory(historyQuery)
    })

    return () => {
      offStatus()
      offProgress()
      offRuntime()
      offLog()
      offCompleted()
      offFailed()
    }
  }, [activeTaskId, historyQuery, ipcClient, pushLog, refreshHistory, setTaskState])
}
