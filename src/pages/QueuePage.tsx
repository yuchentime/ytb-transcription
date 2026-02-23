import type { QueueTaskRecord } from '../../electron/core/db/types'
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
}

export function QueuePage(props: QueuePageProps) {
  return (
    <section className="panel main-panel">
      <div className="queue-page-header">
        <div>
          <h1>任务队列</h1>
          <div className="queue-header-tags">
            <span className="queue-header-tag time">更新时间：{props.model.updatedAt || '-'}</span>
            <span className="queue-header-tag waiting">待处理：{props.model.waitingCount}</span>
            <span className="queue-header-tag running">进行中：{props.model.runningCount}</span>
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
      {props.model.paused ? <p className="hint">队列已暂停，运行中任务会继续，新的 waiting 任务不会出队。</p> : null}

      <QueueBoard
        waiting={props.model.snapshot.waiting}
        running={props.model.snapshot.running}
        onReorder={props.actions.onReorder}
        onRemove={props.actions.onRemove}
      />
    </section>
  )
}
