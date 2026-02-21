export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const safeConcurrency = Math.max(1, Math.floor(concurrency))
  const results: T[] = new Array(tasks.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const current = nextIndex
      if (current >= tasks.length) {
        return
      }
      nextIndex += 1
      results[current] = await tasks[current]()
    }
  }

  const workers = Array.from(
    { length: Math.min(safeConcurrency, tasks.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}
