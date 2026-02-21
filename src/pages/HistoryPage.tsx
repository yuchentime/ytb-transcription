import type { TaskRecord, TaskStatus } from '../../electron/core/db/types'

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
}

interface HistoryPageActions {
  onHistoryKeywordDraftChange(value: string): void
  onHistoryStatusDraftChange(value: 'all' | TaskStatus): void
  onHistoryLanguageDraftChange(value: 'all' | 'zh' | 'en' | 'ja'): void
  onHistoryPageSizeChange(value: number): void
  onApplyFilters(): void
  onRefresh(): Promise<void>
  onLoadTaskDetail(taskId: string): Promise<void>
  onRetryTask(taskId: string): Promise<void>
  onDeleteTask(taskId: string): Promise<void>
  onExportDiagnostics(taskId: string): Promise<void>
  onPrevPage(): void
  onNextPage(): void
  formatDateTime(value: string | null): string
}

interface HistoryPageProps {
  model: HistoryPageModel
  actions: HistoryPageActions
}

export function HistoryPage(props: HistoryPageProps) {
  return (
    <section className="panel main-panel">
      <h2>History</h2>

      <div className="history-filters">
        <label>
          Keyword
          <input
            type="text"
            value={props.model.historyKeywordDraft}
            onChange={(event) => props.actions.onHistoryKeywordDraftChange(event.target.value)}
            placeholder="Search URL/title"
          />
        </label>

        <label>
          Status
          <select
            value={props.model.historyStatusDraft}
            onChange={(event) => props.actions.onHistoryStatusDraftChange(event.target.value as 'all' | TaskStatus)}
          >
            <option value="all">all</option>
            <option value="completed">completed</option>
            <option value="failed">failed</option>
            <option value="canceled">canceled</option>
            <option value="queued">queued</option>
            <option value="downloading">downloading</option>
            <option value="extracting">extracting</option>
            <option value="transcribing">transcribing</option>
            <option value="translating">translating</option>
            <option value="synthesizing">synthesizing</option>
            <option value="merging">merging</option>
            <option value="idle">idle</option>
          </select>
        </label>

        <label>
          Target Language
          <select
            value={props.model.historyLanguageDraft}
            onChange={(event) =>
              props.actions.onHistoryLanguageDraftChange(event.target.value as 'all' | 'zh' | 'en' | 'ja')
            }
          >
            <option value="all">all</option>
            <option value="zh">zh</option>
            <option value="en">en</option>
            <option value="ja">ja</option>
          </select>
        </label>

        <label>
          Page Size
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
            Apply Filters
          </button>
          <button className="btn" onClick={() => void props.actions.onRefresh()}>
            Refresh
          </button>
        </div>
      </div>

      {props.model.historyError && <p className="error">{props.model.historyError}</p>}

      <div className="table-wrap">
        <table className="history-table">
          <thead>
            <tr>
              <th>Created At</th>
              <th>Status</th>
              <th>Target</th>
              <th>URL</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!props.model.historyLoading && props.model.historyItems.length === 0 && (
              <tr>
                <td colSpan={5} className="hint-cell">
                  No history records.
                </td>
              </tr>
            )}

            {props.model.historyItems.map((item) => (
              <tr key={item.id}>
                <td>{props.actions.formatDateTime(item.createdAt)}</td>
                <td>{item.status}</td>
                <td>{item.targetLanguage}</td>
                <td className="url-cell" title={item.youtubeUrl}>
                  {item.youtubeTitle || item.youtubeUrl}
                </td>
                <td>
                  <div className="table-actions">
                    <button className="btn small" onClick={() => void props.actions.onLoadTaskDetail(item.id)}>
                      查看
                    </button>
                    <button
                      className="btn small"
                      disabled={!!props.model.historyBusyTaskId}
                      onClick={() => void props.actions.onRetryTask(item.id)}
                    >
                      {props.model.historyBusyTaskId === item.id ? '处理中...' : '重试'}
                    </button>
                    <button
                      className="btn small"
                      disabled={!!props.model.historyBusyTaskId}
                      onClick={() => void props.actions.onDeleteTask(item.id)}
                    >
                      删除
                    </button>
                    <button
                      className="btn small"
                      disabled={!!props.model.historyBusyTaskId}
                      onClick={() => void props.actions.onExportDiagnostics(item.id)}
                    >
                      导出诊断
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button className="btn" disabled={!props.model.canPrevPage} onClick={props.actions.onPrevPage}>
          Prev
        </button>
        <span>
          Page {props.model.historyPage} / {props.model.historyTotalPages} (Total: {props.model.historyTotal})
        </span>
        <button className="btn" disabled={!props.model.canNextPage} onClick={props.actions.onNextPage}>
          Next
        </button>
      </div>
    </section>
  )
}
