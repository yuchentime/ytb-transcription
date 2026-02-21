import type { TaskRecord, TaskStatus } from '../../electron/core/db/types'
import type { TranslateFn } from '../app/i18n'
import { translateLanguageLabel, translateStatusFilter, translateTaskStatus } from '../app/i18n'

interface HistoryPageModel {
  historyKeywordDraft: string
  historyStatusDraft: 'all' | TaskStatus
  historyLanguageDraft: 'all' | 'zh' | 'en' | 'ja'
  historyPageSize: number
  historyError: string
  historyLoading: boolean
  historyItems: TaskRecord[]
  historyBusyTaskId: string
  historyPage: number
  historyTotalPages: number
  historyTotal: number
  canPrevPage: boolean
  canNextPage: boolean
  historyRecoverableOnly: boolean
  playingTaskId: string
  playingAudioUrl: string
}

interface HistoryPageActions {
  onHistoryKeywordDraftChange(value: string): void
  onHistoryStatusDraftChange(value: 'all' | TaskStatus): void
  onHistoryLanguageDraftChange(value: 'all' | 'zh' | 'en' | 'ja'): void
  onRecoverableOnlyChange(value: boolean): void
  onHistoryPageSizeChange(value: number): void
  onApplyFilters(): void
  onRefresh(): Promise<void>
  onLoadTaskDetail(taskId: string): Promise<void>
  onResumeTask(taskId: string): Promise<void>
  onDeleteTask(taskId: string): Promise<void>
  onPlayAudio(taskId: string): Promise<void>
  onStopAudio(): void
  onPrevPage(): void
  onNextPage(): void
  formatDateTime(value: string | null): string
}

interface HistoryPageProps {
  model: HistoryPageModel
  actions: HistoryPageActions
  t: TranslateFn
}

export function HistoryPage(props: HistoryPageProps) {
  return (
    <section className="panel main-panel">
      <h1>{props.t('history.title')}</h1>

      <div className="history-filters">
        <label>
          {props.t('history.keyword')}
          <input
            type="text"
            value={props.model.historyKeywordDraft}
            onChange={(event) => props.actions.onHistoryKeywordDraftChange(event.target.value)}
            placeholder={props.t('history.keywordPlaceholder')}
          />
        </label>

        <label>
          {props.t('history.status')}
          <select
            value={props.model.historyStatusDraft}
            onChange={(event) =>
              props.actions.onHistoryStatusDraftChange(event.target.value as 'all' | TaskStatus)
            }
          >
            <option value="all">{translateStatusFilter('all', props.t)}</option>
            <option value="completed">{translateStatusFilter('completed', props.t)}</option>
            <option value="failed">{translateStatusFilter('failed', props.t)}</option>
            <option value="canceled">{translateStatusFilter('canceled', props.t)}</option>
            <option value="queued">{translateStatusFilter('queued', props.t)}</option>
            <option value="downloading">{translateStatusFilter('downloading', props.t)}</option>
            <option value="extracting">{translateStatusFilter('extracting', props.t)}</option>
            <option value="transcribing">{translateStatusFilter('transcribing', props.t)}</option>
            <option value="translating">{translateStatusFilter('translating', props.t)}</option>
            <option value="synthesizing">{translateStatusFilter('synthesizing', props.t)}</option>
            <option value="merging">{translateStatusFilter('merging', props.t)}</option>
            <option value="idle">{translateStatusFilter('idle', props.t)}</option>
          </select>
        </label>

        <label>
          {props.t('history.targetLanguage')}
          <select
            value={props.model.historyLanguageDraft}
            onChange={(event) =>
              props.actions.onHistoryLanguageDraftChange(event.target.value as 'all' | 'zh' | 'en' | 'ja')
            }
          >
            <option value="all">{translateLanguageLabel('all', props.t)}</option>
            <option value="zh">{translateLanguageLabel('zh', props.t)}</option>
            <option value="en">{translateLanguageLabel('en', props.t)}</option>
            <option value="ja">{translateLanguageLabel('ja', props.t)}</option>
          </select>
        </label>

        <label>
          可恢复任务
          <input
            type="checkbox"
            checked={props.model.historyRecoverableOnly}
            onChange={(event) => props.actions.onRecoverableOnlyChange(event.target.checked)}
          />
        </label>

        <label>
          {props.t('history.pageSize')}
          <select
            value={props.model.historyPageSize}
            onChange={(event) => props.actions.onHistoryPageSizeChange(Number(event.target.value))}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </label>

        <div className="history-filter-actions">
          <button className="btn primary" onClick={props.actions.onApplyFilters}>
            {props.t('history.applyFilters')}
          </button>
          <button className="btn" onClick={() => void props.actions.onRefresh()}>
            {props.t('history.refresh')}
          </button>
        </div>
      </div>

      {props.model.historyError && <p className="error">{props.model.historyError}</p>}

      <div className="table-wrap">
        <table className="history-table">
          <thead>
            <tr>
              <th>{props.t('history.createdAt')}</th>
              <th>{props.t('history.status')}</th>
              <th>{props.t('history.target')}</th>
              <th>{props.t('history.url')}</th>
              <th>{props.t('history.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {!props.model.historyLoading && props.model.historyItems.length === 0 && (
              <tr>
                <td colSpan={5} className="hint-cell">
                  {props.t('history.noRecords')}
                </td>
              </tr>
            )}

            {props.model.historyItems.map((item) => (
              <tr key={item.id}>
                <td>{props.actions.formatDateTime(item.createdAt)}</td>
                <td>{translateTaskStatus(item.status, props.t)}</td>
                <td>{translateLanguageLabel(item.targetLanguage, props.t)}</td>
                <td className="url-cell" title={item.youtubeUrl}>
                  {item.youtubeTitle || item.youtubeUrl}
                </td>
                <td>
                  <div className="table-actions">
                    {/* Play/Stop Button - Always first */}
                    {item.status === 'completed' ? (
                      <button
                        className="btn small icon-btn"
                        disabled={!!props.model.historyBusyTaskId}
                        onClick={() =>
                          props.model.playingTaskId === item.id
                            ? props.actions.onStopAudio()
                            : void props.actions.onPlayAudio(item.id)
                        }
                        title={props.model.playingTaskId === item.id ? '停止' : '播放'}
                      >
                        {props.model.playingTaskId === item.id ? (
                          /* Stop Icon */
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="4" y="4" width="16" height="16" />
                          </svg>
                        ) : (
                          /* Play Icon */
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </button>
                    ) : (
                      /* Disabled Play Icon */
                      <button className="btn small icon-btn" disabled title="无音频">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.3">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </button>
                    )}

                    <button className="btn small" onClick={() => void props.actions.onLoadTaskDetail(item.id)}>
                      {props.t('history.view')}
                    </button>

                    <button
                      className="btn small"
                      disabled={item.status !== 'failed' || !!props.model.historyBusyTaskId}
                      onClick={() => void props.actions.onResumeTask(item.id)}
                    >
                      恢复
                    </button>

                    <button
                      className="btn small"
                      disabled={!!props.model.historyBusyTaskId}
                      onClick={() => void props.actions.onDeleteTask(item.id)}
                    >
                      {props.t('history.delete')}
                    </button>
                  </div>
                  {props.model.playingTaskId === item.id && props.model.playingAudioUrl && (
                    <div className="history-audio-player">
                      <audio controls autoPlay src={props.model.playingAudioUrl} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <span>
          {props.t('history.pageInfo', {
            page: props.model.historyPage,
            totalPages: props.model.historyTotalPages,
            total: props.model.historyTotal,
          })}
        </span>
        <div className="pagination-controls">
          <button className="btn" disabled={!props.model.canPrevPage} onClick={props.actions.onPrevPage}>
            {props.t('history.prev')}
          </button>
          <button className="btn" disabled={!props.model.canNextPage} onClick={props.actions.onNextPage}>
            {props.t('history.next')}
          </button>
        </div>
      </div>
    </section>
  )
}
