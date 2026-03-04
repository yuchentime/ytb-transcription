import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { TaskSegmentRecord, TaskStatus } from '../../electron/core/db/types'
import type { TaskRuntimeEventPayload } from '../../electron/ipc/channels'
import type { TranslateFn } from '../app/i18n'
import { translateLanguageLabel, translateTaskStatus } from '../app/i18n'
import { Alert } from '../components/Alert'
import { RuntimePreparingModal } from '../components/RuntimePreparingModal'
import { Toast } from '../components/Toast'

interface TaskFormState {
  youtubeUrl: string
  targetLanguage: 'zh' | 'en' | 'ja'
  sourceLanguage: string
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
  isTranslateModelConfigured: boolean
  isTtsModelConfigured: boolean
  taskRunning: boolean
  taskError: string
  activeTaskId: string
  activeStatus: TaskStatus | ''
  stageProgress: Record<string, number>
  overallProgress: number
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
  processingYoutubeTitle: string
  /** 运行环境准备弹窗可见性 */
  isRuntimeModalVisible: boolean
  /** 运行环境组件状态映射 */
  runtimeComponentStatus: Record<string, TaskRuntimeEventPayload>
  /** 首次启动运行环境预检状态 */
  runtimeBootstrapStatus: 'idle' | 'preparing' | 'ready' | 'error'
  /** 首次启动运行环境预检错误信息 */
  runtimeBootstrapMessage: string
}

interface TaskPageActions {
  setTaskForm: Dispatch<SetStateAction<TaskFormState>>
  onStartTask(): Promise<void>
  onCancelTask(): Promise<void>
  onReloadRuntime(): Promise<void>
  onDownloadAudio(): Promise<void>
  onOpenOutputDirectory(): Promise<void>
  onRetrySingleSegment(segmentId: string): Promise<void>
  onResumeTask?(): Promise<void>
}

interface TaskPageProps {
  model: TaskPageModel
  actions: TaskPageActions
  t: TranslateFn
}

const SOURCE_LANGUAGE_OPTIONS = ['en', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'ar', 'hi'] as const

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

function AlertIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function LoaderIcon({ className }: { className?: string }) {
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
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

function RefreshIcon({ className }: { className?: string }) {
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
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
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
  onCopy?: () => Promise<void>
  copyLabel?: string
  copyDisabled?: boolean
}

function CollapsibleSection({
  title,
  isExpanded,
  onToggle,
  children,
  hasContent,
  onCopy,
  copyLabel,
  copyDisabled = false,
}: CollapsibleSectionProps) {
  return (
    <div className={`collapsible-section ${hasContent ? 'has-content' : ''}`}>
      <div className="collapsible-header-row">
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
        {onCopy && (
          <button
            type="button"
            className="btn small icon-btn logs-copy-btn collapsible-copy-btn"
            onClick={() => void onCopy()}
            disabled={copyDisabled}
            title={copyLabel}
            aria-label={copyLabel}
          >
            <CopyIcon />
          </button>
        )}
      </div>
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
  const [logsCopySuccess, setLogsCopySuccess] = useState(false)
  const [transcriptCopySuccess, setTranscriptCopySuccess] = useState(false)
  const [translationCopySuccess, setTranslationCopySuccess] = useState(false)
  const [isRuntimeReloading, setIsRuntimeReloading] = useState(false)
  const [configToast, setConfigToast] = useState<{
    visible: boolean
    message: string
    key: number
  }>({
    visible: false,
    message: '',
    key: 0,
  })
  const [authToast, setAuthToast] = useState<{
    visible: boolean
    key: number
  }>({
    visible: false,
    key: 0,
  })

  // Detect YouTube authentication error from logs
  useEffect(() => {
    const hasAuthError = props.model.logs.some((log) =>
      log.text.includes('Use --cookies-from-browser or --cookies for the authentication')
    )
    if (hasAuthError && !authToast.visible) {
      setAuthToast((prev) => ({
        visible: true,
        key: prev.key + 1,
      }))
    }
  }, [authToast.visible, props.model.logs])

  // Runtime modal is only shown when missing runtime resources need download/install.
  const hasMissingRuntimeResources = Object.values(props.model.runtimeComponentStatus).some(
    (event) => event.status === 'downloading' || event.status === 'installing' || event.status === 'error'
  )
  const shouldShowRuntimeModal = props.model.isRuntimeModalVisible && hasMissingRuntimeResources

  const hasTranscript = !!props.model.transcriptContent
  const hasTranslation = !!props.model.translationContent
  const logsCopyLabel = logsCopySuccess ? props.t('task.copyLogsDone') : props.t('task.copyLogs')
  const transcriptCopyLabel = transcriptCopySuccess ? props.t('task.copyLogsDone') : props.t('task.copyLogs')
  const translationCopyLabel = translationCopySuccess ? props.t('task.copyLogsDone') : props.t('task.copyLogs')
  const runtimeBlocked = props.model.runtimeBootstrapStatus !== 'ready'
  const runtimeInlineHint =
    props.model.runtimeBootstrapStatus === 'error'
      ? props.t('task.runtimeErrorInline', {
          message: props.model.runtimeBootstrapMessage || props.t('common.hyphen'),
        })
      : props.t('task.runtimePreparingInline')
  const shouldShowTaskError = !!props.model.taskError && props.model.runtimeBootstrapStatus === 'ready'
  const shouldShowRuntimeReload = props.model.runtimeBootstrapStatus === 'error' || isRuntimeReloading

  const handleReloadRuntime = async (): Promise<void> => {
    setIsRuntimeReloading(true)
    try {
      await props.actions.onReloadRuntime()
    } finally {
      setIsRuntimeReloading(false)
    }
  }

  const copyTextToClipboard = async (content: string): Promise<boolean> => {
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
      return true
    } catch {
      return false
    }
  }

  const handleCopyLogs = async (): Promise<void> => {
    if (props.model.logs.length === 0) return
    const content = props.model.logs
      .map((log) => `[${new Date(log.time).toLocaleTimeString()}] [${log.stage}] ${log.text}`)
      .join('\n')
    const copied = await copyTextToClipboard(content)
    setLogsCopySuccess(copied)
    window.setTimeout(() => setLogsCopySuccess(false), 1500)
  }

  const handleCopyTranscript = async (): Promise<void> => {
    const content = (props.model.transcriptContent ?? '').trim()
    if (!content) return
    const copied = await copyTextToClipboard(content)
    setTranscriptCopySuccess(copied)
    window.setTimeout(() => setTranscriptCopySuccess(false), 1500)
  }

  const handleCopyTranslation = async (): Promise<void> => {
    const content = (props.model.translationContent ?? '').trim()
    if (!content) return
    const copied = await copyTextToClipboard(content)
    setTranslationCopySuccess(copied)
    window.setTimeout(() => setTranslationCopySuccess(false), 1500)
  }

  const handleStartTask = (): void => {
    const missingTranslateModel = !props.model.isTranslateModelConfigured
    const missingTtsModel = !props.model.isTtsModelConfigured
    if (missingTranslateModel || missingTtsModel) {
      const message =
        missingTranslateModel && missingTtsModel
          ? `${props.t('validation.translateModelRequired')}；${props.t('validation.ttsModelRequired')}`
          : missingTranslateModel
            ? props.t('validation.translateModelRequired')
            : props.t('validation.ttsModelRequired')
      setConfigToast((prev) => ({
        visible: true,
        message,
        key: prev.key + 1,
      }))
      return
    }

    if (!props.model.isStartDisabled) {
      void props.actions.onStartTask()
    }
  }

  // Check if task is active (running or has progress)
  const isTaskActive = props.model.taskRunning || props.model.activeTaskId !== '' || props.model.overallProgress > 0
  const shouldShowFinalOutput =
    !!props.model.ttsAudioUrl && !props.model.taskRunning && props.model.activeStatus === 'completed'
  const shouldShowProgress = isTaskActive && !shouldShowFinalOutput
  const finalOutputTitle =
    props.model.processingYoutubeTitle || props.model.processingYoutubeUrl || props.t('common.hyphen')
  const isSubmitDisabled =
    props.model.isStartDisabled && props.model.isTranslateModelConfigured && props.model.isTtsModelConfigured

  return (
    <>
      {/* Runtime Preparing Modal */}
      <RuntimePreparingModal
        isVisible={shouldShowRuntimeModal}
        componentStatus={props.model.runtimeComponentStatus}
        t={props.t}
      />

      <div className="task-page-shell">
        <section className={`panel main-panel task-panel ${isTaskActive ? 'task-active' : ''}`}>
          {!isTaskActive && <h1 className="task-title">{props.t('task.title')}</h1>}

          <div className="task-form-grid">
            <div className="task-input-section">
              <label className="youtube-url-label">
                {props.t('task.youtubeUrl')}
                <input
                  type="text"
                  className="youtube-url-input"
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
            </div>

            <div className="task-source-language-section">
              <label className="source-language-label">
                {props.t('task.sourceLanguage')}
                <select
                  className="source-language-select"
                  value={props.model.taskForm.sourceLanguage}
                  onChange={(event) =>
                    props.actions.setTaskForm((prev) => ({
                      ...prev,
                      sourceLanguage: event.target.value,
                    }))
                  }
                >
                  <option value="">{props.t('task.sourceLanguageAuto')}</option>
                  {SOURCE_LANGUAGE_OPTIONS.map((language) => (
                    <option key={language} value={language}>
                      {translateLanguageLabel(language, props.t)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="task-actions">
            <div className="task-submit-action">
              <button
                className="btn primary btn-submit"
                disabled={isSubmitDisabled}
                onClick={handleStartTask}
              >
                {props.t('task.start')}
              </button>
              {shouldShowTaskError && (
                <div className="task-error-actions">
                  <p className="error task-submit-error">
                    <AlertIcon className="task-submit-error-icon" />
                    <span>{props.t('task.processFailedHint')}</span>
                  </p>
                  {props.actions.onResumeTask && (
                    <button
                      type="button"
                      className="icon-btn task-resume-icon-btn"
                      onClick={() => void props.actions.onResumeTask?.()}
                      title={props.t('history.resume')}
                      aria-label={props.t('history.resume')}
                    >
                      <RefreshIcon />
                    </button>
                  )}
                </div>
              )}
              {runtimeBlocked && shouldShowRuntimeReload && (
                <div className="task-runtime-reload">
                  <p className={`task-runtime-hint ${isRuntimeReloading ? '' : 'runtime-error'}`}>
                    {isRuntimeReloading ? props.t('task.runtimePreparingInline') : props.t('task.runtimeRetryInline')}
                  </p>
                  <button
                    type="button"
                    className="task-runtime-reload-btn"
                    onClick={() => void handleReloadRuntime()}
                    disabled={isRuntimeReloading}
                    title={runtimeInlineHint}
                  >
                    <LoaderIcon className={`task-runtime-reload-icon ${isRuntimeReloading ? 'loading' : ''}`} />
                    <span>{isRuntimeReloading ? props.t('task.reloadingRuntime') : props.t('task.reloadRuntime')}</span>
                  </button>
                </div>
              )}
              {runtimeBlocked && !shouldShowRuntimeReload && (
                <p className="task-runtime-hint">{runtimeInlineHint}</p>
              )}
            </div>
            {props.model.taskRunning && (
              <button
                className="btn btn-cancel"
                onClick={() => void props.actions.onCancelTask()}
              >
                {props.t('task.cancel')}
              </button>
            )}
          </div>

          {/* Only show status bar when task is active */}
          {isTaskActive && (
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
              {shouldShowProgress && (
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
          )}

          {/* Final Output Section - only show when audio is ready */}
          {shouldShowFinalOutput && (
            <div className="output-final">
              <div className="output-final-header">
                <div className="output-final-title-wrap">
                  <span className="output-final-title-label">{props.t('history.videoTitle')}:</span>
                  <p className="output-final-title" title={finalOutputTitle}>
                    {finalOutputTitle}
                  </p>
                </div>
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
        <section className="panel main-panel results-panel task-results-panel">
          <CollapsibleSection
            title={props.t('task.transcriptResult')}
            isExpanded={isTranscriptExpanded}
            onToggle={() => setIsTranscriptExpanded(!isTranscriptExpanded)}
            hasContent={hasTranscript}
            onCopy={handleCopyTranscript}
            copyLabel={transcriptCopyLabel}
            copyDisabled={!hasTranscript}
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
            onCopy={handleCopyTranslation}
            copyLabel={translationCopyLabel}
            copyDisabled={!hasTranslation}
          >
            <div className="result-content">
              {props.model.translationContent?.split('\n').map((line, index) => (
                <p key={index} className="result-line">{line}</p>
              ))}
            </div>
          </CollapsibleSection>
        </section>

        <section className="panel main-panel logs-panel">
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
      </div>
      <Toast
        key={configToast.key}
        message={configToast.message}
        visible={configToast.visible}
        onClose={() =>
          setConfigToast((prev) => ({
            ...prev,
            visible: false,
          }))
        }
        type="error"
      />
      <Alert
        message={props.t('error.youtubeAuthRequired')}
        visible={authToast.visible}
        onClose={() =>
          setAuthToast((prev) => ({
            ...prev,
            visible: false,
          }))
        }
        type="error"
      />
    </>
  )
}
