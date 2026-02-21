import { useMemo, useState } from 'react'
import type { TaskSegmentRecord, TaskStatus } from '../../electron/core/db/types'

interface SegmentProgressListProps {
  segments: TaskSegmentRecord[]
  activeStatus: TaskStatus | ''
  onRetrySingle(segmentId: string): Promise<void>
}

export function SegmentProgressList(props: SegmentProgressListProps) {
  const stageOrder: Array<'translating' | 'synthesizing'> = ['translating', 'synthesizing']
  const [stageFilter, setStageFilter] = useState<'all' | 'translating' | 'synthesizing'>('all')
  const sorted = useMemo(
    () =>
      [...props.segments].sort((a, b) => {
        if (a.stageName === b.stageName) return a.segmentIndex - b.segmentIndex
        return a.stageName.localeCompare(b.stageName)
      }),
    [props.segments],
  )
  const failedSegments = useMemo(
    () => sorted.filter((segment) => segment.status === 'failed'),
    [sorted],
  )

  const stageStats = stageOrder
    .map((stageName) => {
      const items = sorted.filter((segment) => segment.stageName === stageName)
      if (items.length === 0) return null
      const success = items.filter((segment) => segment.status === 'success').length
      const failed = items.filter((segment) => segment.status === 'failed').length
      const running = items.filter((segment) => segment.status === 'running').length
      const pending = items.filter((segment) => segment.status === 'pending').length
      const percent = Math.round((success / Math.max(1, items.length)) * 100)
      return {
        stageName,
        total: items.length,
        success,
        failed,
        running,
        pending,
        percent,
        isActive: props.activeStatus === stageName,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
  const currentStageStat = stageStats.find((item) => item.stageName === props.activeStatus)
  const stageAwareSegments = useMemo(
    () =>
      sorted.filter((segment) => {
        if (segment.status === 'failed') return false
        if (stageFilter === 'all') return true
        return segment.stageName === stageFilter
      }),
    [sorted, stageFilter],
  )

  if (props.segments.length === 0) {
    return <p className="hint">无段级数据（M1 任务或尚未进入分段阶段）</p>
  }

  return (
    <div className="segment-progress-list">
      {currentStageStat && (
        <div className="segment-current-stage-hint">
          当前阶段：{currentStageStat.stageName}，已完成 {currentStageStat.success}/{currentStageStat.total}（{currentStageStat.percent}%）
        </div>
      )}

      <div className="segment-stage-summary-grid">
        {stageStats.map((stat) => (
          <div
            key={stat.stageName}
            className={`segment-stage-card ${stat.isActive ? 'active' : ''}`}
          >
            <div className="segment-stage-card-header">
              <span className="segment-stage">{stat.stageName}</span>
              <span className="segment-stage-overview">{stat.success}/{stat.total}</span>
            </div>
            <div className="segment-stage-track">
              <div className="segment-stage-fill" style={{ width: `${stat.percent}%` }} />
            </div>
            <div className="segment-stage-meta">
              <span>成功 {stat.success}</span>
              <span>运行 {stat.running}</span>
              <span>待处理 {stat.pending}</span>
              <span className={stat.failed > 0 ? 'segment-stage-failed' : ''}>失败 {stat.failed}</span>
            </div>
          </div>
        ))}
      </div>

      {failedSegments.length > 0 && (
        <div className="segment-failed-list">
          <h4>失败分段</h4>
          {failedSegments.map((segment) => (
            <div key={segment.id} className="segment-item segment-failed">
              <div className="segment-item-main">
                <span className="segment-stage">{segment.stageName}</span>
                <span className="segment-index">#{segment.segmentIndex + 1}</span>
                <span className="segment-status">{segment.status}</span>
                {segment.durationMs !== null && <span className="segment-duration">{segment.durationMs}ms</span>}
              </div>
              {segment.errorMessage && <div className="segment-error">{segment.errorCode}: {segment.errorMessage}</div>}
              <button className="btn small" onClick={() => void props.onRetrySingle(segment.id)}>
                重试该段
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="segment-stage-toolbar">
        <span>分段明细筛选：</span>
        <button
          className={`btn small ${stageFilter === 'all' ? 'primary' : ''}`}
          type="button"
          onClick={() => setStageFilter('all')}
        >
          全部
        </button>
        {stageStats.map((stat) => (
          <button
            key={stat.stageName}
            className={`btn small ${stageFilter === stat.stageName ? 'primary' : ''}`}
            type="button"
            onClick={() => setStageFilter(stat.stageName)}
          >
            {stat.stageName}
          </button>
        ))}
      </div>

      {stageAwareSegments.map((segment) => (
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
      {stageAwareSegments.length === 0 && (
        <p className="hint">该筛选下暂无可展示的分段明细。</p>
      )}
    </div>
  )
}
