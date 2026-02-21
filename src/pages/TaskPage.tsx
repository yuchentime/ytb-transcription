import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { TaskStatus } from '../../electron/core/db/types'
import type { TranslateFn } from '../app/i18n'
import { translateLanguageLabel, translateRuntimeStatus, translateTaskStatus } from '../app/i18n'

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
  overallProgress: number
  runtimeItems: Record<RuntimeItem['component'], RuntimeItem | undefined>
  output: TaskOutput
  ttsAudioUrl: string
  logs: LogItem[]
  transcriptContent?: string
  translationContent?: string
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
  t: TranslateFn
}

// ChevronDown Icon Component
function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

// ChevronUp Icon Component
function ChevronUpIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  )
}

// Collapsible Section Component
interface CollapsibleSectionProps {
  title: string
  isExpanded: boolean
  onToggle: () => void
  children: React.ReactNode
  hasContent: boolean
}

function CollapsibleSection({ title, isExpanded, onToggle, children, hasContent }: CollapsibleSectionProps) {
  return (
    <div className={`collapsible-section ${hasContent ? 'has-content' : ''}`}>
      <button
        className="collapsible-header"
        onClick={onToggle}
        disabled={!hasContent}
        aria-expanded={isExpanded}
        type="button"
      >
        <span className="collapsible-title">{title}</span>
        {hasContent && (
          <span className="collapsible-icon">
            {isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </span>
        )}
      </button>
      {isExpanded && hasContent && (
        <div className="collapsible-content">
          {children}
        </div>
      )}
    </div>
  )
}

export function TaskPage(props: TaskPageProps) {
  const runtimeEntries = Object.values(props.model.runtimeItems).filter(
    (item): item is RuntimeItem => item !== undefined,
  )

  // State for collapsible sections
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState(false)
  const [isTranslationExpanded, setIsTranslationExpanded] = useState(false)

  // Check if content exists
  const hasTranscript = !!props.model.transcriptContent
  const hasTranslation = !!props.model.translationContent

  return (
    <>
      <section className="panel main-panel">
        <h2>{props.t('task.title')}</h2>

        <div className="grid">
          <label className="full">
            {props.t('task.youtubeUrl')}
            <input
              type="text"
              value={props.model.taskForm.youtubeUrl}
              onChange={(event) =>
                props.actions.setTaskForm((prev) => ({
                  ...prev,
                  youtubeUrl: event.target.value,
                }))
              }
              placeholder={props.t('task.youtubeUrlPlaceholder')}
            />
          </label>

          <label>
            {props.t('task.targetLanguage')}
            <select
              value={props.model.taskForm.targetLanguage}
              onChange={(event) =>
                props.actions.setTaskForm((prev) => ({
                  ...prev,
                  targetLanguage: event.target.value as 'zh' | 'en' | 'ja',
                }))
              }
            >
              <option value="zh">{translateLanguageLabel('zh', props.t)}</option>
              <option value="en">{translateLanguageLabel('en', props.t)}</option>
              <option value="ja">{translateLanguageLabel('ja', props.t)}</option>
            </select>
          </label>
        </div>

        <div className="actions">
          <button
            className="btn primary"
            disabled={props.model.isStartDisabled}
            onClick={() => void props.actions.onStartTask()}
          >
            {props.t('task.start')}
          </button>
          <button
            className="btn"
            disabled={!props.model.taskRunning}
            onClick={() => void props.actions.onCancelTask()}
          >
            {props.t('task.cancel')}
          </button>
          <button
            className="btn"
            disabled={!props.model.activeTaskId}
            onClick={() => void props.actions.onExportDiagnostics(props.model.activeTaskId)}
          >
            {props.t('task.exportDiagnostics')}
          </button>
          {props.model.taskError && <span className="error">{props.model.taskError}</span>}
        </div>

        <div className="status-bar">
          <div className="status-meta">
            <span>
              {props.t('task.idLabel')}: <strong>{props.model.activeTaskId || props.t('common.hyphen')}</strong>
            </span>
            <span>
              {props.t('task.statusLabel')}:{' '}
              <strong>{translateTaskStatus(props.model.activeStatus, props.t)}</strong>
            </span>
          </div>

          <div className="progress-wrap">
            <span className="progress-current">
              {translateTaskStatus(props.model.activeStatus || 'idle', props.t)}
            </span>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${props.model.overallProgress}%` }} />
            </div>
            <span className="progress-percent">{props.model.overallProgress}%</span>
          </div>
        </div>

        {runtimeEntries.length > 0 && (
          <div className="runtime">
            <div className="runtime-header">{props.t('task.runtime')}</div>
            {runtimeEntries.map((item) => (
              <p key={item.component} className="runtime-line">
                [{item.component}] {translateRuntimeStatus(item.status, props.t)}: {item.message}
              </p>
            ))}
          </div>
        )}

        <div className="output">
          <div className="output-row">
            <span className="output-label">{props.t('task.outputTranscript')}</span>
            <span className="output-value">{props.model.output.transcriptPath || props.t('common.hyphen')}</span>
          </div>
          <div className="output-row">
            <span className="output-label">{props.t('task.outputTranslation')}</span>
            <span className="output-value">{props.model.output.translationPath || props.t('common.hyphen')}</span>
          </div>
          <div className="output-row">
            <span className="output-label">{props.t('task.outputTts')}</span>
            {props.model.ttsAudioUrl ? (
              <div className="tts-player">
                <audio controls src={props.model.ttsAudioUrl} />
                <button className="btn small" onClick={() => void props.actions.onDownloadAudio()}>
                  {props.t('task.downloadAudio')}
                </button>
                <button className="btn small" onClick={() => void props.actions.onOpenOutputDirectory()}>
                  {props.t('task.openDirectory')}
                </button>
              </div>
            ) : (
              <span className="output-value">{props.t('common.hyphen')}</span>
            )}
          </div>
        </div>
      </section>

      {/* Collapsible Results Section */}
      <section className="panel main-panel results-panel">
        <CollapsibleSection
          title={props.t('task.transcriptResult')}
          isExpanded={isTranscriptExpanded}
          onToggle={() => setIsTranscriptExpanded(!isTranscriptExpanded)}
          hasContent={hasTranscript}
        >
          <div className="result-content">
            {props.model.transcriptContent?.split('\n').map((line, index) => (
              <p key={index} className="result-line">{line}</p>
            ))}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title={props.t('task.translationResult')}
          isExpanded={isTranslationExpanded}
          onToggle={() => setIsTranslationExpanded(!isTranslationExpanded)}
          hasContent={hasTranslation}
        >
          <div className="result-content">
            {props.model.translationContent?.split('\n').map((line, index) => (
              <p key={index} className="result-line">{line}</p>
            ))}
          </div>
        </CollapsibleSection>
      </section>

      <section className="panel main-panel">
        <h2>{props.t('task.logs')}</h2>
        <div className="logbox">
          {props.model.logs.length === 0 && <p className="hint">{props.t('task.noLogs')}</p>}
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
