import type { DragEvent, ReactNode } from 'react'
import type { QueueTaskRecord } from '../../electron/core/db/types'

interface QueueBoardProps {
  waiting: QueueTaskRecord[]
  running: QueueTaskRecord[]
  completed: QueueTaskRecord[]
  failed: QueueTaskRecord[]
  onReorder(taskId: string, toIndex: number): Promise<void>
  onRemove(taskId: string): Promise<void>
}

function QueueCard({
  task,
  actions,
}: {
  task: QueueTaskRecord
  actions?: ReactNode
}) {
  return (
    <div className="queue-card" draggable={false}>
      <p className="queue-card-id" title={task.taskId}>
        {task.taskId}
      </p>
      <p className="queue-card-url" title={task.youtubeUrl || '-'}>
        YouTube: {task.youtubeUrl || '-'}
      </p>
      {actions ? <div className="queue-card-actions">{actions}</div> : null}
    </div>
  )
}

export function QueueBoard(props: QueueBoardProps) {
  const handleDragStart = (event: DragEvent<HTMLDivElement>, taskId: string, index: number) => {
    event.dataTransfer.setData('text/task-id', taskId)
    event.dataTransfer.setData('text/from-index', String(index))
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>, toIndex: number) => {
    event.preventDefault()
    const taskId = event.dataTransfer.getData('text/task-id')
    if (!taskId) return
    await props.onReorder(taskId, toIndex)
  }

  return (
    <div className="queue-board-grid">
      <section className="queue-column">
        <header>
          <h3>Waiting ({props.waiting.length})</h3>
        </header>

        {props.waiting.length === 0 ? <p className="hint">暂无等待任务</p> : null}

        {props.waiting.map((task, index) => (
          <div
            key={task.taskId}
            className="queue-draggable"
            draggable
            onDragStart={(event) => handleDragStart(event, task.taskId, index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void handleDrop(event, index)}
          >
            <QueueCard
              task={task}
              actions={(
                <>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => void props.onReorder(task.taskId, Math.max(0, index - 1))}
                    disabled={index === 0}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => void props.onReorder(task.taskId, Math.min(props.waiting.length - 1, index + 1))}
                    disabled={index >= props.waiting.length - 1}
                  >
                    下移
                  </button>
                  <button
                    type="button"
                    className="btn small danger"
                    onClick={() => void props.onRemove(task.taskId)}
                  >
                    移除
                  </button>
                </>
              )}
            />
          </div>
        ))}
      </section>

      <section className="queue-column">
        <header>
          <h3>Running ({props.running.length})</h3>
        </header>
        {props.running.length === 0 ? <p className="hint">暂无运行任务</p> : null}
        {props.running.map((task) => (
          <QueueCard key={task.taskId} task={task} />
        ))}
      </section>

      <section className="queue-column">
        <header>
          <h3>Completed ({props.completed.length})</h3>
        </header>
        {props.completed.length === 0 ? <p className="hint">暂无完成任务</p> : null}
        {props.completed.map((task) => (
          <QueueCard key={task.taskId} task={task} />
        ))}
      </section>

      <section className="queue-column">
        <header>
          <h3>Failed ({props.failed.length})</h3>
        </header>
        {props.failed.length === 0 ? <p className="hint">暂无失败任务</p> : null}
        {props.failed.map((task) => (
          <QueueCard key={task.taskId} task={task} />
        ))}
      </section>
    </div>
  )
}
