import type { RecoveryAction, RecoveryErrorKind, RecoveryPlan, TaskSegmentRecord } from '../../db/types'
import { TaskRecoveryDao } from '../../db/dao/TaskRecoveryDao'
import { TaskSegmentDao } from '../../db/dao/TaskSegmentDao'

function classifyError(errorCode: string | null, errorMessage: string | null): RecoveryErrorKind {
  const normalized = `${errorCode ?? ''} ${errorMessage ?? ''}`.toLowerCase()
  if (!normalized) return 'retryable'

  if (
    normalized.includes('401') ||
    normalized.includes('403') ||
    normalized.includes('permission') ||
    normalized.includes('forbidden')
  ) {
    return 'non-retryable'
  }

  if (
    normalized.includes('config') ||
    normalized.includes('invalid') ||
    normalized.includes('range') ||
    normalized.includes('voice')
  ) {
    return 'config-invalid'
  }

  if (
    normalized.includes('timeout') ||
    normalized.includes('network') ||
    normalized.includes('429') ||
    normalized.includes('rate')
  ) {
    return 'retryable'
  }

  return 'retryable'
}

function buildActions(failedSegments: TaskSegmentRecord[], hasCheckpoint: boolean): RecoveryAction[] {
  if (failedSegments.length === 0) {
    return hasCheckpoint
      ? [
          {
            action: 'resumeFromCheckpoint',
            label: '从最近检查点继续',
            reason: '已存在可用检查点，可以直接续跑。',
          },
        ]
      : []
  }

  const actions: RecoveryAction[] = []
  const kinds = new Set(
    failedSegments.map((segment) => classifyError(segment.errorCode, segment.errorMessage)),
  )

  if (kinds.has('retryable')) {
    actions.push({
      action: 'retryFailedSegments',
      label: '重试失败分段',
      reason: '存在可重试错误（网络/超时/限流），建议先重试失败段。',
    })
    actions.push({
      action: 'waitAndRetry',
      label: '稍后再试',
      reason: '若当前频繁失败，建议等待后再重试。',
    })
  }

  if (kinds.has('config-invalid')) {
    actions.push({
      action: 'fixConfig',
      label: '修复配置后重试',
      reason: '检测到参数或模型配置问题，请先修复设置。',
    })
  }

  if (kinds.has('non-retryable')) {
    actions.push({
      action: 'checkPermissions',
      label: '检查权限或路径',
      reason: '存在权限类错误，请检查输出目录和访问权限。',
    })
  }

  if (hasCheckpoint) {
    actions.push({
      action: 'resumeFromCheckpoint',
      label: '从最近检查点恢复',
      reason: '已成功段可复用，恢复速度更快。',
    })
  }

  return actions
}

export class RecoveryPlanner {
  constructor(
    private readonly taskSegmentDao: TaskSegmentDao,
    private readonly taskRecoveryDao: TaskRecoveryDao,
  ) {}

  createPlan(taskId: string): RecoveryPlan {
    const failedSegments = this.taskSegmentDao.listFailedSegments(taskId)
    const latest = this.taskRecoveryDao.getLatestSnapshot(taskId)
    const fromStage = latest?.stageName ?? failedSegments[0]?.stageName ?? null

    return {
      taskId,
      fromStage,
      failedSegments: failedSegments.map((segment) => ({
        id: segment.id,
        stageName: segment.stageName,
        errorCode: segment.errorCode,
        errorMessage: segment.errorMessage,
      })),
      actions: buildActions(failedSegments, Boolean(latest)),
    }
  }
}

export { classifyError }
