import type { Dispatch, SetStateAction } from 'react'
import type { TaskStatus } from '../../electron/core/db/types'

interface TaskFormState {
  youtubeUrl: string
  targetLanguage: 'zh' | 'en' | 'ja'
}

interface TaskOutput {
  ttsPath?: string
  transcriptPath?: string
  translationPath?: string
}

interface LogItem {
  id: number
  time: string
  stage: string
  level: 'info' | 'warn' | 'error'
  text: string
}

interface RuntimeItem {
  component: 'yt-dlp' | 'ffmpeg' | 'python' | 'whisper' | 'deno' | 'engine'
  status: 'checking' | 'downloading' | 'installing' | 'ready' | 'error'
  message: string
  timestamp: string
}

interface TaskPageModel {
  stages: readonly string[]
  taskForm: TaskFormState
  isStartDisabled: boolean
  taskRunning: boolean
  taskError: string
  activeTaskId: string
  activeStatus: TaskStatus | ''
  stageProgress: Record<string, number>
  runtimeItems: Record<RuntimeItem['component'], RuntimeItem | undefined>
  output: TaskOutput
  ttsAudioUrl: string
  logs: LogItem[]
}

interface TaskPageActions {
  setTaskForm: Dispatch<SetStateAction<TaskFormState>>
  onStartTask(): Promise<void>
  onCancelTask(): Promise<void>
  onExportDiagnostics(taskId: string): Promise<void>
  onDownloadAudio(): Promise<void>
  onOpenOutputDirectory(): Promise<void>
}

interface TaskPageProps {
  model: TaskPageModel
  actions: TaskPageActions
}

export function TaskPage(props: TaskPageProps) {
  const runtimeEntries = Object.values(props.model.runtimeItems).filter(
    (item): item is RuntimeItem => item !== undefined,
  )

  return (
    <>
      <section className="panel main-panel">
        <h2>Run Task</h2>

        <div className="grid">
          <label className="full">
            YouTube URL
            <input
              type="text"
              value={props.model.taskForm.youtubeUrl}
              onChange={(event) =>
                props.actions.setTaskForm((prev) => ({
                  ...prev,
                  youtubeUrl: event.target.value,
                }))
              }
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </label>

          <label>
            Target Language
            <select
              value={props.model.taskForm.targetLanguage}
              onChange={(event) =>
                props.actions.setTaskForm((prev) => ({
                  ...prev,
                  targetLanguage: event.target.value as 'zh' | 'en' | 'ja',
                }))
              }
            >
              <option value="zh">zh</option>
              <option value="en">en</option>
              <option value="ja">ja</option>
            </select>
          </label>
        </div>

        <div className="actions">
          <button
            className="btn primary"
            disabled={props.model.isStartDisabled}
            onClick={() => void props.actions.onStartTask()}
          >
            Start Task
          </button>
          <button
            className="btn"
            disabled={!props.model.taskRunning}
            onClick={() => void props.actions.onCancelTask()}
          >
            Cancel Task
          </button>
          <button
            className="btn"
            disabled={!props.model.activeTaskId}
            onClick={() => void props.actions.onExportDiagnostics(props.model.activeTaskId)}
          >
            导出诊断
          </button>
          {props.model.taskError && <span className="error">{props.model.taskError}</span>}
        </div>

        <div className="status">
          <span>Task ID: {props.model.activeTaskId || '-'}</span>
          <span>Status: {props.model.activeStatus || '-'}</span>
        </div>

        <ul className="progress-list">
          {props.model.stages.map((stage) => (
            <li key={stage}>
              <span>{stage}</span>
              <div className="bar">
                <div className="fill" style={{ width: `${props.model.stageProgress[stage] ?? 0}%` }} />
              </div>
              <span>{props.model.stageProgress[stage] ?? 0}%</span>
            </li>
          ))}
        </ul>

        <div className="runtime">
          <h3>Runtime</h3>
          {runtimeEntries.map((item) => (
            <p key={item.component} className="runtime-line">
              [{item.component}] {item.status}: {item.message}
            </p>
          ))}
          {runtimeEntries.length === 0 && <p className="hint">No runtime updates yet.</p>}
        </div>

        <div className="output">
          <p>transcript: {props.model.output.transcriptPath || '-'}</p>
          <p>translation: {props.model.output.translationPath || '-'}</p>
          <div className="tts-output">
            <span>tts:</span>
            {props.model.ttsAudioUrl ? (
              <div className="tts-player">
                <audio controls src={props.model.ttsAudioUrl} />
                <button className="btn small" onClick={() => void props.actions.onDownloadAudio()}>
                  下载
                </button>
                <button className="btn small" onClick={() => void props.actions.onOpenOutputDirectory()}>
                  打开目录
                </button>
              </div>
            ) : (
              '-'
            )}
          </div>
        </div>
      </section>

      <section className="panel main-panel">
        <h2>Logs</h2>
        <div className="logbox">
          {props.model.logs.length === 0 && <p className="hint">No logs yet.</p>}
          {props.model.logs.map((log) => (
            <p key={log.id} className={`log ${log.level}`}>
              [{new Date(log.time).toLocaleTimeString()}] [{log.stage}] {log.text}
            </p>
          ))}
        </div>
      </section>
    </>
  )
}
