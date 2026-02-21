import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

export interface RunCommandOptions {
  command: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
  isCanceled?: () => boolean
  onSpawn?: (child: ChildProcessWithoutNullStreams) => void
}

function createLineBuffer(onLine?: (line: string) => void): (chunk: string) => void {
  let buffer = ''
  return (chunk: string) => {
    if (!onLine) return
    buffer += chunk
    const parts = buffer.split(/\r?\n/)
    buffer = parts.pop() ?? ''
    for (const line of parts) {
      const trimmed = line.trim()
      if (trimmed) onLine(trimmed)
    }
  }
}

export async function runCommand(options: RunCommandOptions): Promise<{ code: number }> {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: 'pipe',
  })

  options.onSpawn?.(child)

  const pushStdout = createLineBuffer(options.onStdoutLine)
  const pushStderr = createLineBuffer(options.onStderrLine)

  child.stdout.on('data', (chunk: Buffer) => pushStdout(chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => pushStderr(chunk.toString()))

  return await new Promise<{ code: number }>((resolve, reject) => {
    let canceled = false
    let timedOut = false
    const cancelInterval = setInterval(() => {
      if (options.isCanceled?.() && !canceled) {
        canceled = true
        child.kill('SIGTERM')
      }
    }, 120)
    const timeoutTimer =
      typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
        }, options.timeoutMs)
        : null

    child.on('error', (error) => {
      clearInterval(cancelInterval)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      reject(error)
    })

    child.on('close', (code) => {
      clearInterval(cancelInterval)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      if (options.isCanceled?.()) {
        reject(new Error('Command canceled'))
        return
      }
      if (timedOut) {
        reject(new Error(`Command timeout after ${options.timeoutMs}ms: ${options.command} ${options.args.join(' ')}`))
        return
      }
      if (code !== 0) {
        reject(new Error(`Command failed with code ${code}: ${options.command} ${options.args.join(' ')}`))
        return
      }
      resolve({ code: code ?? 0 })
    })
  })
}
