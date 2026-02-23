import type { TaskStatus } from '../../electron/core/db/types'

export type AppLocale = 'zh-CN' | 'zh-TW'

const LOCALE_STORAGE_KEY = 'ytb-locale'

const zhCNMessages = {
  'app.title': 'YTB2Voice',
  'app.subtitle': '下载视频 → 提取音频 → 提取字幕 → 翻译 → AI 配音',
  'app.localeSwitcherLabel': '界面语言',
  'app.locale.zhCN': '简体',
  'app.locale.zhTW': '繁体',

  'menu.title': '菜单',
  'menu.ariaMainNavigation': '主导航',

  'route.task': '任务',
  'route.queue': '队列',
  'route.history': '历史',
  'route.settings': '设置',
  'route.about': '关于我',

  'task.title': '运行任务',
  'task.youtubeUrl': 'YouTube 链接',
  'task.youtubeUrlPlaceholder': 'https://www.youtube.com/watch?v=...',
  'task.targetLanguage': '目标语言',
  'task.start': '提交任务',
  'task.cancel': '取消任务',
  'task.idLabel': '任务 ID',
  'task.statusLabel': '状态',
  'task.processingTask': '处理中任务',
  'task.queuedToast': '已提交任务至队列',
  'task.runtime': '运行时',
  'task.outputTranscript': '转录',
  'task.outputTranslation': '翻译',
  'task.outputTts': '配音',
  'task.downloadAudio': '下载',
  'task.openDirectory': '目录',
  'task.logs': '日志',
  'task.copyLogs': '复制日志',
  'task.copyLogsDone': '已复制',
  'task.noLogs': '暂无日志。',
  'task.transcriptResult': '转录结果',
  'task.translationResult': '翻译结果',
  'task.noTranscriptContent': '暂无转录内容',
  'task.noTranslationContent': '暂无翻译内容',
  'task.finalOutput': '成果',
  'task.completed': '已完成',

  'history.title': '历史记录',
  'history.keyword': '关键词',
  'history.keywordPlaceholder': '搜索链接/标题',
  'history.status': '状态',
  'history.targetLanguage': '目标语言',
  'history.pageSize': '每页数量',
  'history.applyFilters': '应用筛选',
  'history.refresh': '刷新',
  'history.createdAt': '创建时间',
  'history.target': '目标',
  'history.url': '链接',
  'history.actions': '操作',
  'history.noRecords': '暂无历史记录。',
  'history.view': '查看',
  'history.processing': '处理中...',
  'history.retry': '重试',
  'history.downloadArtifacts': '下载',
  'history.delete': '删除',
  'history.pageInfo': '第 {page} / {totalPages} 页（共 {total} 条）',
  'history.prev': '上一页',
  'history.next': '下一页',
  'history.deleteConfirmTitle': '确认删除任务？',
  'history.deleteConfirm': '确定删除任务 {taskId}？这会移除数据库记录和本地产物。',
  'history.resumeOverrideTitle': '切换正在执行的任务？',
  'history.resumeOverrideConfirm':
    '当前任务 {runningTaskId} 正在处理中。继续恢复任务 {taskId} 将中断当前任务，是否继续？',
  'history.resumeOverrideConfirmButton': '中断并恢复',
  'history.floatingPlayerAriaLabel': '悬浮音频播放器',
  'history.closePlayer': '关闭播放器',

  'settings.title': '设置',
  'settings.loading': '正在加载设置...',
  'settings.group.youtube': 'YouTube 下载设置',
  'settings.group.transcription': '转录设置',
  'settings.group.translation': '翻译设置',
  'settings.group.minimax': 'MiniMax 设置',
  'settings.group.tts': '语音合成设置',
  'settings.providerReadonly': '服务提供方（只读）',
  'settings.translateProvider': '翻译服务提供方',
  'settings.ttsProvider': '语音合成服务提供方',
  'settings.translateApiKey': 'API Key',
  'settings.translateBaseUrl': 'Base URL',
  'settings.ttsApiKey': 'API Key',
  'settings.ttsBaseUrl': 'Base URL',
  'settings.youtubeDownloadAuth': 'YouTube 下载鉴权',
  'settings.auth.none': '无',
  'settings.auth.browserCookies': '浏览器 Cookies',
  'settings.auth.cookiesFile': 'Cookies 文件',
  'settings.cookiesBrowser': 'Cookies 浏览器',
  'settings.cookiesFilePath': 'Cookies 文件路径',
  'settings.whisperModel': 'Whisper 模型',
  'settings.minimaxApiKey': 'MiniMax API Key',
  'settings.minimaxBaseUrl': 'MiniMax Base URL',
  'settings.translateModelId': '翻译模型',
  'settings.ttsModelId': '语音合成模型',
  'settings.ttsVoiceId': 'TTS 音色 ID',
  'settings.selectModel': '请选择模型',
  'settings.translateConnectivityTest': '连通测试',
  'settings.translateConnectivityTesting': '测试中...',
  'settings.translateConnectivityPass': '测试通过✅',
  'settings.translateConnectivityFail': '测试失败，请检查配置',
  'settings.defaultTargetLanguage': '默认目标语言',
  'settings.advanced': '高级选项',
  'settings.translateTemperature': '翻译温度',
  'settings.ttsSpeed': 'TTS 语速',
  'settings.ttsPitch': 'TTS 音调',
  'settings.ttsVolume': 'TTS 音量',
  'settings.stageTimeoutMs': '阶段超时（毫秒）',
  'settings.retryDownload': '重试：下载',
  'settings.retryTranslate': '重试：翻译',
  'settings.retryTts': '重试：TTS',
  'settings.retryTranscribe': '重试：转录',
  'settings.securityNote': '安全提示：翻译和 TTS 会将文本内容发送到第三方云 API。',
  'settings.paramRanges': '参数范围：语速 0.5-2.0，音调 -10~10，音量 0~10。',
  'settings.saving': '保存中...',
  'settings.save': '保存设置',
  'settings.saveSuccess': '设置已保存',
  'settings.saveFailed': '保存失败',
  'settings.piperInstallSuccess': '安装成功✅',
  'settings.piperInstallFailed': '安装失败，请检查配置',

  'status.all': '全部',
  'status.idle': '空闲',
  'status.queued': '排队中',
  'status.downloading': '下载中',
  'status.extracting': '提取中',
  'status.transcribing': '转录中',
  'status.translating': '翻译中',
  'status.synthesizing': '合成中',
  'status.merging': '合并中',
  'status.completed': '已完成',
  'status.failed': '失败',
  'status.canceled': '已取消',

  'runtime.checking': '检查中',
  'runtime.downloading': '下载中',
  'runtime.installing': '安装中',
  'runtime.ready': '就绪',
  'runtime.error': '错误',

  'lang.all': '全部',
  'lang.zh': '中文',
  'lang.zhCN': '简体中文',
  'lang.zhTW': '繁体中文',

  'error.loadHistory': '加载历史记录失败',
  'error.loadTaskDetail': '加载任务详情失败',
  'error.loadSettings': '加载设置失败',
  'error.saveSettings': '保存设置失败',
  'error.startTask': '启动任务失败',
  'error.cancelTask': '取消任务失败',
  'error.taskNotAccepted': '任务未被接受',
  'error.downloadAudio': '下载音频失败：{message}',
  'error.openPath': '打开路径失败：{message}',
  'error.deleteTask': '删除任务失败',
  'error.noExportableArtifacts': '未找到可导出的音频、转录或翻译文件',
  'error.downloadArtifacts': '导出文件失败：{message}',
  'error.retryTask': '重试任务失败',
  'error.taskNotDeleted': '任务未被删除',
  'error.retryNotAccepted': '重试请求未被接受',
  'error.loadAudio': '加载音频失败：{message}',

  'log.loadedTaskDetail': '已加载任务详情：{taskId}',
  'log.settingsSaved': '设置已保存',
  'log.statusChanged': '状态 -> {status}',
  'log.taskCompleted': '任务完成',
  'log.deletedTask': '已删除任务：{taskId}',
  'log.artifactsExported': '已导出任务产物：{taskId}（{count} 个文件）',
  'log.retryRequested': '已发起重试：{taskId}',

  'common.cancel': '取消',
  'common.hyphen': '-',
} as const

type TranslateKey = keyof typeof zhCNMessages
type Messages = Record<TranslateKey, string>

const zhTWMessages: Messages = {
  'app.title': 'YTB2Voice',
  'app.subtitle': '下載影片 → 擷取音訊 → 提取字幕 → 翻譯 → AI 配音',
  'app.localeSwitcherLabel': '介面語言',
  'app.locale.zhCN': '簡體',
  'app.locale.zhTW': '繁體',

  'menu.title': '選單',
  'menu.ariaMainNavigation': '主導航',

  'route.task': '任務',
  'route.queue': '隊列',
  'route.history': '歷史',
  'route.settings': '設定',
  'route.about': '關於我',

  'task.title': '執行任務',
  'task.youtubeUrl': 'YouTube 連結',
  'task.youtubeUrlPlaceholder': 'https://www.youtube.com/watch?v=...',
  'task.targetLanguage': '目標語言',
  'task.start': '提交任務',
  'task.cancel': '取消任務',
  'task.idLabel': '任務 ID',
  'task.statusLabel': '狀態',
  'task.processingTask': '處理中任務',
  'task.queuedToast': '已提交任務至隊列',
  'task.runtime': '執行時',
  'task.outputTranscript': '轉錄',
  'task.outputTranslation': '翻譯',
  'task.outputTts': '配音',
  'task.downloadAudio': '下載',
  'task.openDirectory': '目錄',
  'task.logs': '日誌',
  'task.copyLogs': '複製日誌',
  'task.copyLogsDone': '已複製',
  'task.noLogs': '暫無日誌。',
  'task.transcriptResult': '轉錄結果',
  'task.translationResult': '翻譯結果',
  'task.noTranscriptContent': '暫無轉錄內容',
  'task.noTranslationContent': '暫無翻譯內容',
  'task.finalOutput': '成果',
  'task.completed': '已完成',

  'history.title': '歷史記錄',
  'history.keyword': '關鍵字',
  'history.keywordPlaceholder': '搜尋連結/標題',
  'history.status': '狀態',
  'history.targetLanguage': '目標語言',
  'history.pageSize': '每頁數量',
  'history.applyFilters': '套用篩選',
  'history.refresh': '重新整理',
  'history.createdAt': '建立時間',
  'history.target': '目標',
  'history.url': '連結',
  'history.actions': '操作',
  'history.noRecords': '暫無歷史記錄。',
  'history.view': '查看',
  'history.processing': '處理中...',
  'history.retry': '重試',
  'history.downloadArtifacts': '下載',
  'history.delete': '刪除',
  'history.pageInfo': '第 {page} / {totalPages} 頁（共 {total} 筆）',
  'history.prev': '上一頁',
  'history.next': '下一頁',
  'history.deleteConfirmTitle': '確認刪除任務？',
  'history.deleteConfirm': '確定刪除任務 {taskId}？這會移除資料庫記錄和本地產物。',
  'history.resumeOverrideTitle': '切換正在執行的任務？',
  'history.resumeOverrideConfirm':
    '目前任務 {runningTaskId} 正在處理中。繼續恢復任務 {taskId} 將中斷目前任務，是否繼續？',
  'history.resumeOverrideConfirmButton': '中斷並恢復',
  'history.floatingPlayerAriaLabel': '懸浮音訊播放器',
  'history.closePlayer': '關閉播放器',

  'settings.title': '設定',
  'settings.loading': '正在載入設定...',
  'settings.group.youtube': 'YouTube 下載設定',
  'settings.group.transcription': '轉錄設定',
  'settings.group.translation': '翻譯設定',
  'settings.group.minimax': 'MiniMax 設定',
  'settings.group.tts': '語音合成設定',
  'settings.providerReadonly': '服務提供方（唯讀）',
  'settings.translateProvider': '翻譯服務提供方',
  'settings.ttsProvider': '語音合成服務提供方',
  'settings.translateApiKey': 'API Key',
  'settings.translateBaseUrl': 'Base URL',
  'settings.ttsApiKey': 'API Key',
  'settings.ttsBaseUrl': 'Base URL',
  'settings.youtubeDownloadAuth': 'YouTube 下載驗證',
  'settings.auth.none': '無',
  'settings.auth.browserCookies': '瀏覽器 Cookies',
  'settings.auth.cookiesFile': 'Cookies 檔案',
  'settings.cookiesBrowser': 'Cookies 瀏覽器',
  'settings.cookiesFilePath': 'Cookies 檔案路徑',
  'settings.whisperModel': 'Whisper 模型',
  'settings.minimaxApiKey': 'MiniMax API Key',
  'settings.minimaxBaseUrl': 'MiniMax Base URL',
  'settings.translateModelId': '翻譯模型 ID',
  'settings.ttsModelId': '語音合成模型',
  'settings.ttsVoiceId': 'TTS 音色 ID',
  'settings.selectModel': '請選擇模型',
  'settings.translateConnectivityTest': '連通測試',
  'settings.translateConnectivityTesting': '測試中...',
  'settings.translateConnectivityPass': '測試通過✅',
  'settings.translateConnectivityFail': '測試失敗，請檢查設定',
  'settings.defaultTargetLanguage': '預設目標語言',
  'settings.advanced': '進階選項',
  'settings.translateTemperature': '翻譯溫度',
  'settings.ttsSpeed': 'TTS 語速',
  'settings.ttsPitch': 'TTS 音調',
  'settings.ttsVolume': 'TTS 音量',
  'settings.stageTimeoutMs': '階段逾時（毫秒）',
  'settings.retryDownload': '重試：下載',
  'settings.retryTranslate': '重試：翻譯',
  'settings.retryTts': '重試：TTS',
  'settings.retryTranscribe': '重試：轉錄',
  'settings.securityNote': '安全提示：翻譯和 TTS 會將文字內容傳送到第三方雲端 API。',
  'settings.paramRanges': '參數範圍：語速 0.5-2.0，音調 -10~10，音量 0~10。',
  'settings.saving': '儲存中...',
  'settings.save': '儲存設定',
  'settings.saveSuccess': '設定已儲存',
  'settings.saveFailed': '儲存失敗',
  'settings.piperInstallSuccess': '安裝成功✅',
  'settings.piperInstallFailed': '安裝失敗，請檢查設定',

  'status.all': '全部',
  'status.idle': '閒置',
  'status.queued': '排隊中',
  'status.downloading': '下載中',
  'status.extracting': '擷取中',
  'status.transcribing': '轉錄中',
  'status.translating': '翻譯中',
  'status.synthesizing': '合成中',
  'status.merging': '合併中',
  'status.completed': '已完成',
  'status.failed': '失敗',
  'status.canceled': '已取消',

  'runtime.checking': '檢查中',
  'runtime.downloading': '下載中',
  'runtime.installing': '安裝中',
  'runtime.ready': '就緒',
  'runtime.error': '錯誤',

  'lang.all': '全部',
  'lang.zh': '中文',
  'lang.zhCN': '簡體中文',
  'lang.zhTW': '繁體中文',

  'error.loadHistory': '載入歷史記錄失敗',
  'error.loadTaskDetail': '載入任務詳情失敗',
  'error.loadSettings': '載入設定失敗',
  'error.saveSettings': '儲存設定失敗',
  'error.startTask': '啟動任務失敗',
  'error.cancelTask': '取消任務失敗',
  'error.taskNotAccepted': '任務未被接受',
  'error.downloadAudio': '下載音訊失敗：{message}',
  'error.openPath': '開啟路徑失敗：{message}',
  'error.deleteTask': '刪除任務失敗',
  'error.noExportableArtifacts': '未找到可匯出的音訊、轉錄或翻譯檔案',
  'error.downloadArtifacts': '匯出檔案失敗：{message}',
  'error.retryTask': '重試任務失敗',
  'error.taskNotDeleted': '任務未被刪除',
  'error.retryNotAccepted': '重試請求未被接受',
  'error.loadAudio': '載入音訊失敗：{message}',

  'log.loadedTaskDetail': '已載入任務詳情：{taskId}',
  'log.settingsSaved': '設定已儲存',
  'log.statusChanged': '狀態 -> {status}',
  'log.taskCompleted': '任務完成',
  'log.deletedTask': '已刪除任務：{taskId}',
  'log.artifactsExported': '已匯出任務產物：{taskId}（{count} 個檔案）',
  'log.retryRequested': '已發起重試：{taskId}',

  'common.cancel': '取消',
  'common.hyphen': '-',
}

const MESSAGES: Record<AppLocale, Messages> = {
  'zh-CN': zhCNMessages,
  'zh-TW': zhTWMessages,
}

export type TranslateParams = Record<string, string | number>
export type TranslateFn = (key: TranslateKey, params?: TranslateParams) => string

const TASK_STATUS_KEYS: Record<TaskStatus, TranslateKey> = {
  idle: 'status.idle',
  queued: 'status.queued',
  downloading: 'status.downloading',
  extracting: 'status.extracting',
  transcribing: 'status.transcribing',
  translating: 'status.translating',
  synthesizing: 'status.synthesizing',
  merging: 'status.merging',
  completed: 'status.completed',
  failed: 'status.failed',
  canceled: 'status.canceled',
}

const RUNTIME_STATUS_KEYS: Record<'checking' | 'downloading' | 'installing' | 'ready' | 'error', TranslateKey> = {
  checking: 'runtime.checking',
  downloading: 'runtime.downloading',
  installing: 'runtime.installing',
  ready: 'runtime.ready',
  error: 'runtime.error',
}

const ROUTE_KEYS: Record<'task' | 'queue' | 'history' | 'settings' | 'about', TranslateKey> = {
  task: 'route.task',
  queue: 'route.queue',
  history: 'route.history',
  settings: 'route.settings',
  about: 'route.about',
}

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_fullMatch, key: string) => {
    const value = params[key]
    return value === undefined ? `{${key}}` : String(value)
  })
}

export function resolveLocale(input?: string | null): AppLocale {
  if (!input) return 'zh-CN'

  const normalized = input.toLowerCase()
  if (
    normalized.startsWith('zh-tw') ||
    normalized.startsWith('zh-hk') ||
    normalized.startsWith('zh-mo') ||
    normalized.includes('hant')
  ) {
    return 'zh-TW'
  }

  return 'zh-CN'
}

export function getInitialLocale(): AppLocale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored) {
      return resolveLocale(stored)
    }
  } catch {
    // Ignore storage access failures and use browser locale fallback.
  }

  return resolveLocale(window.navigator.language)
}

export function saveLocale(locale: AppLocale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Ignore storage access failures.
  }
}

export function createTranslator(locale: AppLocale): TranslateFn {
  const messages = MESSAGES[locale]

  return (key, params) => interpolate(messages[key], params)
}

export function translateTaskStatus(status: TaskStatus | '', t: TranslateFn): string {
  if (!status) return t('common.hyphen')
  return t(TASK_STATUS_KEYS[status])
}

export function translateStatusFilter(status: 'all' | TaskStatus, t: TranslateFn): string {
  if (status === 'all') {
    return t('status.all')
  }
  return t(TASK_STATUS_KEYS[status])
}

export function translateRuntimeStatus(
  status: 'checking' | 'downloading' | 'installing' | 'ready' | 'error',
  t: TranslateFn,
): string {
  return t(RUNTIME_STATUS_KEYS[status])
}

export function translateRouteLabel(
  route: 'task' | 'queue' | 'history' | 'settings' | 'about',
  t: TranslateFn,
): string {
  return t(ROUTE_KEYS[route])
}

export function translateLanguageLabel(language: string, t: TranslateFn): string {
  switch (language) {
    case 'all':
      return t('lang.all')
    case 'zh-CN':
      return t('lang.zhCN')
    case 'zh-TW':
      return t('lang.zhTW')
    case 'zh':
      return t('lang.zh')
    case 'en':
      return 'English'
    case 'ja':
      return '日本語'
    default:
      return language
  }
}
