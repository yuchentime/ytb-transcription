import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { TaskSegmentRecord, TaskStatus, VoiceProfile } from '../../electron/core/db/types'
import type { TranslateFn } from '../app/i18n'
import { translateRuntimeStatus, translateTaskStatus } from '../app/i18n'
import { SegmentProgressList } from '../components/SegmentProgressList'
import { SegmentationConfigPanel } from '../components/SegmentationConfigPanel'

interface TaskFormState {
  youtubeUrl: string
  targetLanguage: 'zh' | 'en' | 'ja'
  segmentationStrategy: 'punctuation' | 'sentence' | 'duration'
  segmentationTargetDurationSec: number
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
  voiceProfiles: VoiceProfile[]
  taskFormErrors: string[]
  segments: TaskSegmentRecord[]
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
                  targetLanguage: event.target.value as 'zh' | 'en' | 'ja',
                }))
              }
            >
              <option value="zh">{props.t('lang.zhCN')}</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </label>

          <label className="full">
            <SegmentationConfigPanel
              taskForm={props.model.taskForm}
              setTaskForm={props.actions.setTaskForm}
            />
          </label>

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

          {/* Hide progress when audio is ready */}
          {!props.model.ttsAudioUrl && (
            <div className="progress-wrap">
              <span className="progress-current">
                {translateTaskStatus(props.model.activeStatus || 'idle', props.t)}
              </span>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${props.model.overallProgress}%` }} />
              </div>
              <span className="progress-percent">{props.model.overallProgress}%</span>
            </div>
          )}
        </div>

        {/* {runtimeEntries.length > 0 && (
          <div className="runtime">
            <div className="runtime-header">{props.t('task.runtime')}</div>
            {runtimeEntries.map((item) => (
              <p key={item.component} className="runtime-line">
                [{item.component}] {translateRuntimeStatus(item.status, props.t)}: {item.message}
              </p>
            ))}
          </div>
        )} */}

        <div className="task-m2-section">
          <h3>段级进度</h3>
          <SegmentProgressList
            segments={props.model.segments}
            activeStatus={props.model.activeStatus}
            onRetrySingle={props.actions.onRetrySingleSegment}
          />
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
