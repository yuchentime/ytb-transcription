export class WorkerPool {
  private readonly maxConcurrency: number
  private readonly runningBySlot = new Map<number, string>()

  constructor(workerConcurrency: number) {
    this.maxConcurrency = Math.min(2, Math.max(1, Math.floor(workerConcurrency || 1)))
  }

  capacity(): number {
    return this.maxConcurrency
  }

  runningCount(): number {
    return this.runningBySlot.size
  }

  hasCapacity(): boolean {
    return this.runningBySlot.size < this.maxConcurrency
  }

  acquire(taskId: string): number | null {
    if (!this.hasCapacity()) return null
    for (let slot = 0; slot < this.maxConcurrency; slot += 1) {
      if (!this.runningBySlot.has(slot)) {
        this.runningBySlot.set(slot, taskId)
        return slot
      }
    }
    return null
  }

  releaseByTask(taskId: string): number | null {
    for (const [slot, runningTaskId] of this.runningBySlot.entries()) {
      if (runningTaskId === taskId) {
        this.runningBySlot.delete(slot)
        return slot
      }
    }
    return null
  }

  runningTaskIds(): string[] {
    return Array.from(this.runningBySlot.values())
  }
}
