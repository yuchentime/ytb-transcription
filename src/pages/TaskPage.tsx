import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { TaskSegmentRecord, TaskStatus, VoiceProfile } from '../../electron/core/db/types'
import type { TranslateFn } from '../app/i18n'
import { translateTaskStatus } from '../app/i18n'

interface TaskFormState {
  youtubeUrl: string
  targetLanguage: 'zh' | 'en' | 'ja'
  ttsVoiceId: string
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
  voiceProfiles: VoiceProfile[]
  isPiperTts: boolean
  taskFormErrors: string[]
  segments: TaskSegmentRecord[]
  output: TaskOutput
  ttsAudioUrl: string
  logs: LogItem[]
  transcriptContent?: string
  translationContent?: string
  /** 当前下载速度（仅在 downloading 阶段有效） */
  downloadSpeed?: string
  processingYoutubeUrl: string
}

interface TaskPageActions {
  setTaskForm: Dispatch<SetStateAction<TaskFormState>>
  onStartTask(): Promise<void>
  onCancelTask(): Promise<void>
  onDownloadAudio(): Promise<void>
  onOpenOutputDirectory(): Promise<void>
  onRetrySingleSegment(segmentId: string): Promise<void>
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

// Check Icon Component
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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
  // State for collapsible sections
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState(false)
  const [isTranslationExpanded, setIsTranslationExpanded] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)

  // Check if content exists
  const hasTranscript = !!props.model.transcriptContent
  const hasTranslation = !!props.model.translationContent
  const logsCopyLabel = copySuccess ? props.t('task.copyLogsDone') : props.t('task.copyLogs')

  const handleCopyLogs = async (): Promise<void> => {
    if (props.model.logs.length === 0) return
    const content = props.model.logs
      .map((log) => `[${new Date(log.time).toLocaleTimeString()}] [${log.stage}] ${log.text}`)
      .join('\n')

    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = content
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopySuccess(true)
      window.setTimeout(() => setCopySuccess(false), 1500)
    } catch {
      setCopySuccess(false)
    }
  }

  return (
    <>
      <section className="panel main-panel">
        <h1>{props.t('task.title')}</h1>

        <div className="grid two-col">
          <label>
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
                  targetLanguage: event.target.value as 'zh',
                }))
              }
            >
              <option value="zh">{props.t('lang.zh')}</option>
            </select>
          </label>

          {!props.model.isPiperTts && (
            <label>
              音色预设
              <select
                value={props.model.taskForm.ttsVoiceId}
                onChange={(event) =>
                  props.actions.setTaskForm((prev) => ({
                    ...prev,
                    ttsVoiceId: event.target.value,
                  }))
                }
              >
                <option value="">请选择音色</option>
                {props.model.voiceProfiles.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {props.model.taskFormErrors.length > 0 && (
          <div className="error task-form-errors">
            {props.model.taskFormErrors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        )}

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
            <span className={`processing-task-chip ${props.model.processingYoutubeUrl ? 'active' : ''}`}>
              {props.t('task.processingTask')}:{' '}
              <strong title={props.model.processingYoutubeUrl || props.t('common.hyphen')}>
                {props.model.processingYoutubeUrl || props.t('common.hyphen')}
              </strong>
            </span>
          </div>

          {/* Hide progress when audio is ready */}
          {!props.model.ttsAudioUrl && (
            <div className="progress-wrap">
              <span className="progress-current">
                {translateTaskStatus(props.model.activeStatus || 'idle', props.t)}
                {/* 在下载阶段显示下载速度 */}
                {props.model.activeStatus === 'downloading' && props.model.downloadSpeed && (
                  <span className="download-speed">{props.model.downloadSpeed}</span>
                )}
              </span>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${props.model.overallProgress}%` }} />
              </div>
              <span className="progress-percent">{props.model.overallProgress}%</span>
            </div>
          )}
        </div>

        {/* Final Output Section - only show when audio is ready */}
        {props.model.ttsAudioUrl && (
          <div className="output-final">
            <div className="output-final-header">
              <span className="output-final-badge">{props.t('task.finalOutput')}</span>
              <span className="output-final-status">
                <CheckIcon />
                {props.t('task.completed')}
              </span>
            </div>
            <div className="output-final-content">
              <div className="tts-player-final">
                <audio controls src={props.model.ttsAudioUrl} />
                <div className="tts-actions">
                  <button className="btn primary" onClick={() => void props.actions.onDownloadAudio()}>
                    {props.t('task.downloadAudio')}
                  </button>
                  <button className="btn" onClick={() => void props.actions.onOpenOutputDirectory()}>
                    {props.t('task.openDirectory')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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
        <div className="logs-header">
          <h2>{props.t('task.logs')}</h2>
          <button
            type="button"
            className="btn small icon-btn logs-copy-btn"
            onClick={() => void handleCopyLogs()}
            disabled={props.model.logs.length === 0}
            title={logsCopyLabel}
            aria-label={logsCopyLabel}
          >
            <CopyIcon />
          </button>
        </div>
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
