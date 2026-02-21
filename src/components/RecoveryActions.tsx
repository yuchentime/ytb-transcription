import type { RecoveryAction } from '../../electron/core/db/types'

interface RecoveryActionsProps {
  actions: RecoveryAction[]
  disabled?: boolean
  onRetryFailedSegments(): Promise<void>
  onResumeFromCheckpoint(): Promise<void>
  onRefreshPlan(): Promise<void>
}

export function RecoveryActions(props: RecoveryActionsProps) {
  const { actions, disabled } = props
  const canRetry = actions.some((action) => action.action === 'retryFailedSegments')
  const canResume = actions.some((action) => action.action === 'resumeFromCheckpoint')

  return (
    <div className="recovery-actions">
      <div className="recovery-actions-row">
        <button className="btn small" disabled={disabled || !canRetry} onClick={() => void props.onRetryFailedSegments()}>
          重试失败分段
        </button>
        <button className="btn small" disabled={disabled || !canResume} onClick={() => void props.onResumeFromCheckpoint()}>
          从检查点恢复
        </button>
        <button className="btn small" disabled={disabled} onClick={() => void props.onRefreshPlan()}>
          查看恢复建议
        </button>
      </div>

      {actions.length > 0 && (
        <ul className="recovery-plan-list">
          {actions.map((action, index) => (
            <li key={`${action.action}-${index}`}>
              <strong>{action.label}</strong>：{action.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
