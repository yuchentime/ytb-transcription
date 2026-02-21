import type { TaskSegmentRecord } from '../../electron/core/db/types'

interface SegmentProgressListProps {
  segments: TaskSegmentRecord[]
  onRetrySingle(segmentId: string): Promise<void>
}

export function SegmentProgressList(props: SegmentProgressListProps) {
  if (props.segments.length === 0) {
    return <p className="hint">无段级数据（M1 任务或尚未进入分段阶段）</p>
  }

  const sorted = [...props.segments].sort((a, b) => {
    if (a.stageName === b.stageName) return a.segmentIndex - b.segmentIndex
    return a.stageName.localeCompare(b.stageName)
  })

  return (
    <div className="segment-progress-list">
      {sorted.map((segment) => (
        <div key={segment.id} className={`segment-item segment-${segment.status}`}>
          <div className="segment-item-main">
            <span className="segment-stage">{segment.stageName}</span>
            <span className="segment-index">#{segment.segmentIndex + 1}</span>
            <span className="segment-status">{segment.status}</span>
            {segment.durationMs !== null && <span className="segment-duration">{segment.durationMs}ms</span>}
          </div>
          {segment.errorMessage && <div className="segment-error">{segment.errorCode}: {segment.errorMessage}</div>}
          {segment.status === 'failed' && (
            <button className="btn small" onClick={() => void props.onRetrySingle(segment.id)}>
              重试该段
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
