import type { TaskStatus } from '../../electron/core/db/types'

export type AppLocale = 'zh' | 'en'

const LOCALE_STORAGE_KEY = 'ytb-locale'

const zhMessages = {
  'app.title': 'YTB2Voice',
  'app.subtitle': '下载视频 → 提取音频 → 提取字幕 → 翻译 → AI 配音',
  'app.localeSwitcherLabel': '界面语言',
  'app.locale.zh': '中文',
  'app.locale.en': 'English',

  'menu.title': '菜单',
  'menu.ariaMainNavigation': '主导航',

  'route.task': '任务',
  'route.queue': '队列',
  'route.history': '历史',
  'route.settings': '设置',
  'route.about': '关于我',

  'queue.title': '任务队列',
  'queue.updatedAt': '更新时间：{time}',
  'queue.waitingCount': '待处理：{count}',
  'queue.runningCount': '进行中：{count}',
  'queue.pausedHint': '队列已暂停，运行中任务会继续，新的 waiting 任务不会出队。',

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
  'history.resume': '恢复',
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
  'settings.piperInstall': '一键安装Piper',
  'settings.piperReinstall': '重新安装Piper',
  'settings.piperInstalling': '安装中...',
  'settings.piperProbe': '检测 Piper 就绪状态',
  'settings.piperProbing': '检测中...',
  'settings.piperProbeSuccess': '检测通过✅',
  'settings.piperProbeFail': '检测失败，请检查配置',
  'settings.provider.minimax': 'MiniMax',
  'settings.provider.deepseek': 'DeepSeek',
  'settings.provider.glm': 'GLM (智谱AI)',
  'settings.provider.kimi': 'Kimi (Moonshot)',
  'settings.provider.custom': '自定义(OpenAI-compatible)',
  'settings.provider.piper': '本地语音合成（Piper）',
  'settings.piper.localModelHint': 'Piper 使用本地模型，不依赖云端 API Key/Base URL。',
  'settings.piper.installHint': '首次使用可一键安装 Piper 运行环境与默认音色模型（自动下载）。',

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

type TranslateKey = keyof typeof zhMessages
type Messages = Record<TranslateKey, string>

const enMessages: Messages = {
  'app.title': 'YTB2Voice',
  'app.subtitle': 'Download Video → Extract Audio → Transcribe → Translate → AI Voiceover',
  'app.localeSwitcherLabel': 'Language',
  'app.locale.zh': '中文',
  'app.locale.en': 'English',

  'menu.title': 'Menu',
  'menu.ariaMainNavigation': 'Main Navigation',

  'route.task': 'Task',
  'route.queue': 'Queue',
  'route.history': 'History',
  'route.settings': 'Settings',
  'route.about': 'About',

  'queue.title': 'Task Queue',
  'queue.updatedAt': 'Updated: {time}',
  'queue.waitingCount': 'Waiting: {count}',
  'queue.runningCount': 'Running: {count}',
  'queue.pausedHint': 'Queue is paused. Running tasks will continue, but new tasks will not start.',

  'task.title': 'Run Task',
  'task.youtubeUrl': 'YouTube URL',
  'task.youtubeUrlPlaceholder': 'https://www.youtube.com/watch?v=...',
  'task.targetLanguage': 'Target Language',
  'task.start': 'Submit Task',
  'task.cancel': 'Cancel Task',
  'task.idLabel': 'Task ID',
  'task.statusLabel': 'Status',
  'task.processingTask': 'Processing Task',
  'task.queuedToast': 'Task queued',
  'task.runtime': 'Runtime',
  'task.outputTranscript': 'Transcript',
  'task.outputTranslation': 'Translation',
  'task.outputTts': 'TTS',
  'task.downloadAudio': 'Download',
  'task.openDirectory': 'Directory',
  'task.logs': 'Logs',
  'task.copyLogs': 'Copy Logs',
  'task.copyLogsDone': 'Copied',
  'task.noLogs': 'No logs available.',
  'task.transcriptResult': 'Transcript Result',
  'task.translationResult': 'Translation Result',
  'task.noTranscriptContent': 'No transcript content',
  'task.noTranslationContent': 'No translation content',
  'task.finalOutput': 'Output',
  'task.completed': 'Completed',

  'history.title': 'History',
  'history.keyword': 'Keyword',
  'history.keywordPlaceholder': 'Search URL/title',
  'history.status': 'Status',
  'history.targetLanguage': 'Target Language',
  'history.pageSize': 'Page Size',
  'history.applyFilters': 'Apply Filters',
  'history.refresh': 'Refresh',
  'history.createdAt': 'Created At',
  'history.target': 'Target',
  'history.url': 'URL',
  'history.actions': 'Actions',
  'history.noRecords': 'No history records.',
  'history.view': 'View',
  'history.processing': 'Processing...',
  'history.retry': 'Retry',
  'history.resume': 'Resume',
  'history.downloadArtifacts': 'Download',
  'history.delete': 'Delete',
  'history.pageInfo': 'Page {page} / {totalPages} ({total} total)',
  'history.prev': 'Previous',
  'history.next': 'Next',
  'history.deleteConfirmTitle': 'Confirm Delete?',
  'history.deleteConfirm': 'Delete task {taskId}? This will remove the database record and local artifacts.',
  'history.resumeOverrideTitle': 'Switch Running Task?',
  'history.resumeOverrideConfirm':
    'Task {runningTaskId} is currently processing. Resuming task {taskId} will interrupt the current task. Continue?',
  'history.resumeOverrideConfirmButton': 'Interrupt & Resume',
  'history.floatingPlayerAriaLabel': 'Floating Audio Player',
  'history.closePlayer': 'Close Player',

  'settings.title': 'Settings',
  'settings.loading': 'Loading settings...',
  'settings.group.youtube': 'YouTube Download Settings',
  'settings.group.transcription': 'Transcription Settings',
  'settings.group.translation': 'Translation Settings',
  'settings.group.minimax': 'MiniMax Settings',
  'settings.group.tts': 'TTS Settings',
  'settings.providerReadonly': 'Provider (Read-only)',
  'settings.translateProvider': 'Translation Provider',
  'settings.ttsProvider': 'TTS Provider',
  'settings.translateApiKey': 'API Key',
  'settings.translateBaseUrl': 'Base URL',
  'settings.ttsApiKey': 'API Key',
  'settings.ttsBaseUrl': 'Base URL',
  'settings.youtubeDownloadAuth': 'YouTube Download Auth',
  'settings.auth.none': 'None',
  'settings.auth.browserCookies': 'Browser Cookies',
  'settings.auth.cookiesFile': 'Cookies File',
  'settings.cookiesBrowser': 'Cookies Browser',
  'settings.cookiesFilePath': 'Cookies File Path',
  'settings.whisperModel': 'Whisper Model',
  'settings.minimaxApiKey': 'MiniMax API Key',
  'settings.minimaxBaseUrl': 'MiniMax Base URL',
  'settings.translateModelId': 'Translation Model',
  'settings.ttsModelId': 'TTS Model',
  'settings.ttsVoiceId': 'TTS Voice ID',
  'settings.selectModel': 'Select Model',
  'settings.translateConnectivityTest': 'Connectivity Test',
  'settings.translateConnectivityTesting': 'Testing...',
  'settings.translateConnectivityPass': 'Test Passed✅',
  'settings.translateConnectivityFail': 'Test Failed, please check settings',
  'settings.defaultTargetLanguage': 'Default Target Language',
  'settings.advanced': 'Advanced Options',
  'settings.translateTemperature': 'Translation Temperature',
  'settings.ttsSpeed': 'TTS Speed',
  'settings.ttsPitch': 'TTS Pitch',
  'settings.ttsVolume': 'TTS Volume',
  'settings.stageTimeoutMs': 'Stage Timeout (ms)',
  'settings.retryDownload': 'Retry: Download',
  'settings.retryTranslate': 'Retry: Translation',
  'settings.retryTts': 'Retry: TTS',
  'settings.retryTranscribe': 'Retry: Transcription',
  'settings.securityNote': 'Security Note: Translation and TTS send text content to third-party cloud APIs.',
  'settings.paramRanges': 'Parameter Ranges: Speed 0.5-2.0, Pitch -10~10, Volume 0~10.',
  'settings.saving': 'Saving...',
  'settings.save': 'Save Settings',
  'settings.saveSuccess': 'Settings Saved',
  'settings.saveFailed': 'Save Failed',
  'settings.piperInstallSuccess': 'Install Success✅',
  'settings.piperInstallFailed': 'Install Failed, please check settings',
  'settings.piperInstall': 'Install Piper',
  'settings.piperReinstall': 'Reinstall Piper',
  'settings.piperInstalling': 'Installing...',
  'settings.piperProbe': 'Check Piper Status',
  'settings.piperProbing': 'Checking...',
  'settings.piperProbeSuccess': 'Check Passed✅',
  'settings.piperProbeFail': 'Check Failed, please check settings',
  'settings.provider.minimax': 'MiniMax',
  'settings.provider.deepseek': 'DeepSeek',
  'settings.provider.glm': 'GLM (Zhipu AI)',
  'settings.provider.kimi': 'Kimi (Moonshot)',
  'settings.provider.custom': 'Custom (OpenAI-compatible)',
  'settings.provider.piper': 'Local TTS (Piper)',
  'settings.piper.localModelHint': 'Piper uses local models and does not rely on cloud API Key/Base URL.',
  'settings.piper.installHint': 'For first-time use, you can install the Piper runtime and default voice model with one click (auto-download).',

  'status.all': 'All',
  'status.idle': 'Idle',
  'status.queued': 'Queued',
  'status.downloading': 'Downloading',
  'status.extracting': 'Extracting',
  'status.transcribing': 'Transcribing',
  'status.translating': 'Translating',
  'status.synthesizing': 'Synthesizing',
  'status.merging': 'Merging',
  'status.completed': 'Completed',
  'status.failed': 'Failed',
  'status.canceled': 'Canceled',

  'runtime.checking': 'Checking',
  'runtime.downloading': 'Downloading',
  'runtime.installing': 'Installing',
  'runtime.ready': 'Ready',
  'runtime.error': 'Error',

  'lang.all': 'All',
  'lang.zh': 'Chinese',
  'lang.zhCN': 'Simplified Chinese',
  'lang.zhTW': 'Traditional Chinese',

  'error.loadHistory': 'Failed to load history',
  'error.loadTaskDetail': 'Failed to load task details',
  'error.loadSettings': 'Failed to load settings',
  'error.saveSettings': 'Failed to save settings',
  'error.startTask': 'Failed to start task',
  'error.cancelTask': 'Failed to cancel task',
  'error.taskNotAccepted': 'Task not accepted',
  'error.downloadAudio': 'Failed to download audio: {message}',
  'error.openPath': 'Failed to open path: {message}',
  'error.deleteTask': 'Failed to delete task',
  'error.noExportableArtifacts': 'No exportable audio, transcript or translation files found',
  'error.downloadArtifacts': 'Failed to export files: {message}',
  'error.retryTask': 'Failed to retry task',
  'error.taskNotDeleted': 'Task not deleted',
  'error.retryNotAccepted': 'Retry request not accepted',
  'error.loadAudio': 'Failed to load audio: {message}',

  'log.loadedTaskDetail': 'Loaded task details: {taskId}',
  'log.settingsSaved': 'Settings saved',
  'log.statusChanged': 'Status -> {status}',
  'log.taskCompleted': 'Task completed',
  'log.deletedTask': 'Deleted task: {taskId}',
  'log.artifactsExported': 'Exported task artifacts: {taskId} ({count} files)',
  'log.retryRequested': 'Retry requested: {taskId}',

  'common.cancel': 'Cancel',
  'common.hyphen': '-',
}

const MESSAGES: Record<AppLocale, Messages> = {
  'zh': zhMessages,
  'en': enMessages,
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
  if (!input) return 'zh'

  const normalized = input.toLowerCase()
  // If the input starts with 'en', use English; otherwise default to Chinese
  if (normalized.startsWith('en')) {
    return 'en'
  }

  return 'zh'
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
  const messages = MESSAGES[locale] ?? MESSAGES['zh']

  return (key, params) => interpolate(messages[key] ?? key, params)
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
