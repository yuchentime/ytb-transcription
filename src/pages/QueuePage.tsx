import type { BatchProgressEventPayload } from '../../electron/ipc/channels'
import type { QueueTaskRecord } from '../../electron/core/db/types'
import { QueueBoard } from '../components/QueueBoard'
import { QueueControls } from '../components/QueueControls'

interface QueuePageModel {
  paused: boolean
  loading: boolean
  error: string
  waitingCount: number
  runningCount: number
  completedCount: number
  failedCount: number
  updatedAt: string
  snapshot: {
    waiting: QueueTaskRecord[]
    running: QueueTaskRecord[]
    completed: QueueTaskRecord[]
    failed: QueueTaskRecord[]
  }
  batchProgressMap: Record<string, BatchProgressEventPayload>
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
  const batchProgressItems = Object.values(props.model.batchProgressMap)

  return (
    <section className="panel main-panel">
      <div className="queue-page-header">
        <div>
          <h1>任务队列</h1>
          <div className="queue-header-tags">
            <span className="queue-header-tag time">更新时间：{props.model.updatedAt || '-'}</span>
            <span className="queue-header-tag waiting">待处理：{props.model.waitingCount}</span>
            <span className="queue-header-tag running">进行中：{props.model.runningCount}</span>
            <span className="queue-header-tag completed">已完成：{props.model.completedCount}</span>
            <span className="queue-header-tag failed">失败：{props.model.failedCount}</span>
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
        completed={props.model.snapshot.completed}
        failed={props.model.snapshot.failed}
        onReorder={props.actions.onReorder}
        onRemove={props.actions.onRemove}
      />

      <section className="queue-batch-progress">
        <h2>批次进度</h2>
        {batchProgressItems.length === 0 ? <p className="hint">暂无批次进度事件</p> : null}
        {batchProgressItems.map((progress) => (
          <div key={progress.batchId} className="batch-progress-item">
            <p>
              <strong>{progress.batchId}</strong>
            </p>
            <p>
              total={progress.total} queued={progress.queued} running={progress.running} completed={progress.completed} failed={progress.failed} percent={progress.percent}%
            </p>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
            </div>
          </div>
        ))}
      </section>
    </section>
  )
}
