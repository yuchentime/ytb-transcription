import { ipcMain } from 'electron'
import { getDatabaseContext } from '../../core/db'
import { getBatchCreator } from '../../core/task-engine'
import { IPC_CHANNELS, type BatchConfig, type BatchCreatePayload, type BatchGetPayload } from '../channels'

function assertBatchConfig(config: BatchConfig): BatchConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('sharedConfig is required')
  }

  if (!config.targetLanguage || typeof config.targetLanguage !== 'string') {
    throw new Error('sharedConfig.targetLanguage is required')
  }

  return config
}

function assertBatchCreatePayload(payload: BatchCreatePayload): BatchCreatePayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload is required')
  }

  if (!Array.isArray(payload.urls)) {
    throw new Error('urls must be an array')
  }

  if (payload.urls.length === 0) {
    throw new Error('urls cannot be empty')
  }

  if (payload.urls.length > 200) {
    throw new Error('batch size exceeds limit (200)')
  }

  for (const url of payload.urls) {
    if (typeof url !== 'string') {
      throw new Error('urls must contain string values')
    }
  }

  return {
    ...payload,
    sharedConfig: assertBatchConfig(payload.sharedConfig),
  }
}

function assertBatchGetPayload(payload: BatchGetPayload): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('payload is required')
  }

  if (typeof payload.batchId !== 'string' || payload.batchId.trim().length === 0) {
    throw new Error('batchId is required')
  }

  return payload.batchId.trim()
}

export function registerBatchHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.batchCreate, (_event, payload: BatchCreatePayload) => {
    const validPayload = assertBatchCreatePayload(payload)
    const batchCreator = getBatchCreator()
    return batchCreator.createBatch(validPayload)
  })

  ipcMain.handle(IPC_CHANNELS.batchGet, (_event, payload: BatchGetPayload) => {
    const batchId = assertBatchGetPayload(payload)
    const { batchDao } = getDatabaseContext()
    return batchDao.getBatch(batchId)
  })
}
