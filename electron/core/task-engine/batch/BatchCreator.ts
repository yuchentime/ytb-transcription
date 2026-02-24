import type { BatchDao, TaskDao } from '../../db/dao'
import type { CreateTaskInput } from '../../db/types'
import type { QueueScheduler } from '../queue/QueueScheduler'
import { BatchValidator } from './BatchValidator'

export interface BatchConfig extends Omit<CreateTaskInput, 'youtubeUrl' | 'youtubeTitle' | 'youtubeAuthor'> {}

export interface BatchCreateInput {
  urls: string[]
  sharedConfig: BatchConfig
  name?: string
}

export interface BatchCreateResult {
  batchId: string
  taskIds: string[]
  accepted: number
  rejected: number
  rejectedItems: Array<{
    url: string
    reason: string
  }>
}

export class BatchCreator {
  private readonly validator = new BatchValidator(200)

  constructor(
    private readonly deps: {
      taskDao: TaskDao
      batchDao: BatchDao
      queueScheduler: QueueScheduler
    },
  ) {}

  createBatch(input: BatchCreateInput): BatchCreateResult {
    const validation = this.validator.validate(input.urls)
    const acceptedUrls = validation.accepted
    const rejectedItems = validation.rejected

    const batch = this.deps.batchDao.createBatch({
      name: input.name?.trim() ?? null,
      totalCount: validation.totalCount,
      acceptedCount: acceptedUrls.length,
      rejectedCount: rejectedItems.length,
      status: acceptedUrls.length > 0 ? 'created' : 'failed',
    })

    const createdTasks = acceptedUrls.map((youtubeUrl) => {
      return this.deps.taskDao.createTask({
        youtubeUrl,
        targetLanguage: input.sharedConfig.targetLanguage,
        sourceLanguage: input.sharedConfig.sourceLanguage,
        whisperModel: input.sharedConfig.whisperModel,
        provider: input.sharedConfig.provider,
        translateProvider: input.sharedConfig.translateProvider,
        ttsProvider: input.sharedConfig.ttsProvider,
        translateModelId: input.sharedConfig.translateModelId,
        ttsModelId: input.sharedConfig.ttsModelId,
        ttsVoice: input.sharedConfig.ttsVoice,
        segmentationStrategy: input.sharedConfig.segmentationStrategy,
        segmentationOptions: input.sharedConfig.segmentationOptions,
        ttsSpeed: input.sharedConfig.ttsSpeed,
        ttsPitch: input.sharedConfig.ttsPitch,
        ttsVolume: input.sharedConfig.ttsVolume,
        modelConfigSnapshot: input.sharedConfig.modelConfigSnapshot,
      })
    })

    this.deps.batchDao.addBatchItems(batch.id, [
      ...createdTasks.map((task) => ({
        taskId: task.id,
        youtubeUrl: task.youtubeUrl,
        status: 'queued' as const,
      })),
      ...rejectedItems.map((item) => ({
        taskId: null,
        youtubeUrl: item.url,
        status: 'rejected' as const,
        rejectReason: item.reason,
      })),
    ])

    for (const task of createdTasks) {
      this.deps.queueScheduler.enqueueTask(task.id, batch.id)
    }

    return {
      batchId: batch.id,
      taskIds: createdTasks.map((task) => task.id),
      accepted: acceptedUrls.length,
      rejected: rejectedItems.length,
      rejectedItems,
    }
  }
}
