import type { TaskRuntimeEventPayload } from '../../electron/ipc/channels'
import type { TranslateFn } from '../app/i18n'
import { translateRuntimeStatus } from '../app/i18n'

interface RuntimePreparingModalProps {
  isVisible: boolean
  componentStatus: Record<string, TaskRuntimeEventPayload>
  t: TranslateFn
}

const RUNTIME_COMPONENTS = [
  { key: 'yt-dlp', labelKey: 'runtime.component.yt-dlp' },
  { key: 'ffmpeg', labelKey: 'runtime.component.ffmpeg' },
  { key: 'python', labelKey: 'runtime.component.python' },
  { key: 'whisper', labelKey: 'runtime.component.whisper' },
  { key: 'deno', labelKey: 'runtime.component.deno' },
] as const

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

function LoaderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

function getStatusIcon(status: TaskRuntimeEventPayload['status']) {
  switch (status) {
    case 'ready':
      return <CheckIcon className="status-icon ready" />
    case 'error':
      return <span className="status-icon error">!</span>
    case 'downloading':
    case 'installing':
    case 'checking':
    default:
      return <LoaderIcon className="status-icon loading" />
  }
}

function getStatusClass(status: TaskRuntimeEventPayload['status']) {
  switch (status) {
    case 'ready':
      return 'ready'
    case 'error':
      return 'error'
    case 'downloading':
    case 'installing':
      return 'active'
    case 'checking':
    default:
      return 'pending'
  }
}

export function RuntimePreparingModal({ isVisible, componentStatus, t }: RuntimePreparingModalProps) {
  if (!isVisible) return null

  return (
    <div className="runtime-modal-overlay">
      <div className="runtime-modal">
        <div className="runtime-modal-header">
          <LoaderIcon className="runtime-modal-spinner" />
          <h3>{t('runtime.preparingTitle')}</h3>
        </div>
        <p className="runtime-modal-message">{t('runtime.preparingMessage')}</p>
        <div className="runtime-components-list">
          {RUNTIME_COMPONENTS.map(({ key, labelKey }) => {
            const status = componentStatus[key]?.status ?? 'checking'
            const message = componentStatus[key]?.message ?? ''

            return (
              <div key={key} className={`runtime-component-item ${getStatusClass(status)}`}>
                <div className="runtime-component-header">
                  {getStatusIcon(status)}
                  <span className="runtime-component-name">{t(labelKey)}</span>
                  <span className="runtime-component-status">{translateRuntimeStatus(status, t)}</span>
                </div>
                {message && status !== 'ready' && (
                  <p className="runtime-component-message">{message}</p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
