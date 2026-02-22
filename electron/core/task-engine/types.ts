import type { RecoveryPlan, SegmentStageName, StepName, TaskStatus } from '../db/types'
import type { Toolchain } from './toolchain'
import type { TextSegment } from './segmentation'

/**
 * TaskEngine event definitions.
 */
export interface TaskEngineEvents {
  status: {
    taskId: string
    status: TaskStatus
    timestamp: string
  }
  progress: {
    taskId: string
    stage: StepName | 'queued'
    percent: number
    message: string
    /** 下载速度（格式化的字符串，如 "2.5 MB/s"） */
    speed?: string
  }
  segmentProgress: {
    taskId: string
    stage: SegmentStageName
    segmentId: string
    index: number
    total: number
    percent: number
    message: string
  }
  segmentFailed: {
    taskId: string
    stage: SegmentStageName
    segmentId: string
    errorCode: string
    errorMessage: string
    retryable: boolean
  }
  recoverySuggested: {
    taskId: string
    actions: RecoveryPlan['actions']
  }
  log: {
    taskId: string
    stage: StepName | 'engine'
    level: 'info' | 'warn' | 'error'
    text: string
    timestamp: string
  }
  completed: {
    taskId: string
    output: {
      ttsPath?: string
      transcriptPath?: string
      translationPath?: string
    }
  }
  failed: {
    taskId: string
    stage: StepName
    errorCode: string
    errorMessage: string
  }
  runtime: {
    taskId: string
    component: 'yt-dlp' | 'ffmpeg' | 'python' | 'whisper' | 'deno' | 'engine'
    status: 'checking' | 'downloading' | 'installing' | 'ready' | 'error'
    message: string
    timestamp: string
  }
}

/**
 * Execution context passed through pipeline stages.
 */
export interface TaskExecutionContext {
  taskId: string
  taskDir: string
  toolchain?: Toolchain
  videoPath?: string
  audioPath?: string
  transcriptPath?: string
  translationPath?: string
  ttsRawPath?: string
  finalTtsPath?: string
  translationSegments?: TextSegment[]
  audioDurationSec?: number
}

/**
 * Event name type for TaskEngine.
 */
export type EventName = keyof TaskEngineEvents

/**
 * Listener type for a specific event.
 */
export type Listener<T extends EventName> = (payload: TaskEngineEvents[T]) => void
