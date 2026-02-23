interface QueueControlsProps {
  paused: boolean
  loading: boolean
  onPause(): Promise<void>
  onResume(): Promise<void>
  onRefresh(): Promise<void>
}

export function QueueControls(props: QueueControlsProps) {
  return (
    <div className="queue-controls">
      <button
        type="button"
        className="btn"
        onClick={() => void props.onRefresh()}
        disabled={props.loading}
      >
        刷新
      </button>

      {props.paused ? (
        <button
          type="button"
          className="btn primary"
          onClick={() => void props.onResume()}
          disabled={props.loading}
        >
          恢复队列
        </button>
      ) : (
        <button
          type="button"
          className="btn"
          onClick={() => void props.onPause()}
          disabled={props.loading}
        >
          暂停队列
        </button>
      )}
    </div>
  )
}
