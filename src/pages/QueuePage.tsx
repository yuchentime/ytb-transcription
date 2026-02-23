import type { QueueTaskRecord } from '../../electron/core/db/types'
import type { TranslateFn } from '../app/i18n'
import { QueueBoard } from '../components/QueueBoard'
import { QueueControls } from '../components/QueueControls'

interface QueuePageModel {
  paused: boolean
  loading: boolean
  error: string
  waitingCount: number
  runningCount: number
  updatedAt: string
  snapshot: {
    waiting: QueueTaskRecord[]
    running: QueueTaskRecord[]
  }
}

interface QueuePageActions {
  onPause(): Promise<void>
  onResume(): Promise<void>
  onRefresh(): Promise<void>
  onReorder(taskId: string, toIndex: number): Promise<void>
  onRemove(taskId: string): Promise<void>
}

interface QueuePageProps {
  model: QueuePageModel
  actions: QueuePageActions
  t: TranslateFn
}

export function QueuePage(props: QueuePageProps) {
  const { t } = props

  return (
    <section className="panel main-panel">
      <div className="queue-page-header">
        <div>
          <h1>{t('queue.title')}</h1>
          <div className="queue-header-tags">
            <span className="queue-header-tag time">{t('queue.updatedAt', { time: props.model.updatedAt || '-' })}</span>
            <span className="queue-header-tag waiting">{t('queue.waitingCount', { count: props.model.waitingCount })}</span>
            <span className="queue-header-tag running">{t('queue.runningCount', { count: props.model.runningCount })}</span>
          </div>
        </div>
        <QueueControls
          paused={props.model.paused}
          loading={props.model.loading}
          onPause={props.actions.onPause}
          onResume={props.actions.onResume}
          onRefresh={props.actions.onRefresh}
        />
      </div>

      {props.model.error ? <p className="error">{props.model.error}</p> : null}
      {props.model.paused ? <p className="hint">{t('queue.pausedHint')}</p> : null}

      <QueueBoard
        waiting={props.model.snapshot.waiting}
        running={props.model.snapshot.running}
        onReorder={props.actions.onReorder}
        onRemove={props.actions.onRemove}
      />
    </section>
  )
}
