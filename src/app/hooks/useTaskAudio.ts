import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { RendererAPI } from '../../../electron/ipc/channels'
import type { TranslateFn } from '../i18n'
import type { LogItem, TaskState } from '../state'

interface UseTaskAudioOptions {
  ipcClient: RendererAPI
  ttsPath?: string
  setTaskState: Dispatch<SetStateAction<TaskState>>
  pushLog(item: Omit<LogItem, 'id'>): void
  t: TranslateFn
}

export function useTaskAudio(options: UseTaskAudioOptions): void {
  const { ipcClient, ttsPath, setTaskState, pushLog, t } = options

  useEffect(() => {
    let objectUrl: string | null = null
    let disposed = false

    const loadAudio = async () => {
      if (!ttsPath) {
        setTaskState((prev) => ({
          ...prev,
          ttsAudioUrl: '',
        }))
        return
      }

      try {
        const { data, mimeType } = await ipcClient.file.readAudio(ttsPath)
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
          text: t('error.loadAudio', {
            message: error instanceof Error ? error.message : String(error),
          }),
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
  }, [ipcClient, ttsPath, pushLog, setTaskState, t])
}
