import { ipcRenderer, contextBridge } from 'electron'
import { IPC_CHANNELS, type RendererAPI } from './ipc/channels'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.off(channel, wrapped)
}

const api: RendererAPI = {
  task: {
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.taskCreate, input),
    start: (payload) => ipcRenderer.invoke(IPC_CHANNELS.taskStart, payload),
    cancel: (payload) => ipcRenderer.invoke(IPC_CHANNELS.taskCancel, payload),
    retry: (payload) => ipcRenderer.invoke(IPC_CHANNELS.taskRetry, payload),
    get: (payload) => ipcRenderer.invoke(IPC_CHANNELS.taskGet, payload),
    getRunning: () => ipcRenderer.invoke(IPC_CHANNELS.taskGetRunning),
    segments: (payload) => ipcRenderer.invoke(IPC_CHANNELS.taskSegments, payload),
    retrySegments: (payload) => ipcRenderer.invoke(IPC_CHANNELS.taskRetrySegments, payload),
    resumeFromCheckpoint: (payload) => ipcRenderer.invoke(IPC_CHANNELS.taskResumeFromCheckpoint, payload),
    recoveryPlan: (payload) => ipcRenderer.invoke(IPC_CHANNELS.taskRecoveryPlan, payload),
    onStatus: (listener) => subscribe(IPC_CHANNELS.taskStatus, listener),
    onProgress: (listener) => subscribe(IPC_CHANNELS.taskProgress, listener),
    onSegmentProgress: (listener) => subscribe(IPC_CHANNELS.taskSegmentProgress, listener),
    onSegmentFailed: (listener) => subscribe(IPC_CHANNELS.taskSegmentFailed, listener),
    onRecoverySuggested: (listener) => subscribe(IPC_CHANNELS.taskRecoverySuggested, listener),
    onLog: (listener) => subscribe(IPC_CHANNELS.taskLog, listener),
    onCompleted: (listener) => subscribe(IPC_CHANNELS.taskCompleted, listener),
    onFailed: (listener) => subscribe(IPC_CHANNELS.taskFailed, listener),
    onRuntime: (listener) => subscribe(IPC_CHANNELS.taskRuntime, listener),
  },
  history: {
    list: (query) => ipcRenderer.invoke(IPC_CHANNELS.historyList, query),
    delete: (payload) => ipcRenderer.invoke(IPC_CHANNELS.historyDelete, payload),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC_CHANNELS.settingsUpdate, patch),
  },
  voices: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.voicesList),
    validateParams: (input) => ipcRenderer.invoke(IPC_CHANNELS.voicesValidateParams, input),
  },
  system: {
    openPath: (payload) => ipcRenderer.invoke(IPC_CHANNELS.systemOpenPath, payload),
    exportDiagnostics: (payload) => ipcRenderer.invoke(IPC_CHANNELS.systemExportDiagnostics, payload),
    exportTaskArtifacts: (payload) => ipcRenderer.invoke(IPC_CHANNELS.systemExportTaskArtifacts, payload),
    probePiper: (payload) => ipcRenderer.invoke(IPC_CHANNELS.systemProbePiper, payload),
    installPiper: (payload) => ipcRenderer.invoke(IPC_CHANNELS.systemInstallPiper, payload),
    testTranslateConnectivity: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.systemTestTranslateConnectivity, payload),
  },
  file: {
    readAudio: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.fileReadAudio, filePath),
    readText: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.fileReadText, filePath),
  },
}

contextBridge.exposeInMainWorld('appApi', api)
