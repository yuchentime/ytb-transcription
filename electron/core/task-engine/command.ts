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

const COMMAND_ERROR_EXCERPT_LINES = 40

function createLineBuffer(onLine?: (line: string) => void): {
  push: (chunk: string) => void
  flush: () => void
} {
  let buffer = ''
  return {
    push: (chunk: string) => {
      if (!onLine) return
      buffer += chunk
      const parts = buffer.split(/\r?\n/)
      buffer = parts.pop() ?? ''
      for (const line of parts) {
        const trimmed = line.trim()
        if (trimmed) onLine(trimmed)
      }
    },
    flush: () => {
      if (!onLine) return
      const trimmed = buffer.trim()
      if (trimmed) onLine(trimmed)
      buffer = ''
    },
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

  const stdoutExcerpt: string[] = []
  const stderrExcerpt: string[] = []
  const appendExcerpt = (target: string[], line: string): void => {
    if (!line) return
    target.push(line)
    if (target.length > COMMAND_ERROR_EXCERPT_LINES) {
      target.shift()
    }
  }

  const stdoutBuffer = createLineBuffer((line) => {
    appendExcerpt(stdoutExcerpt, line)
    options.onStdoutLine?.(line)
  })
  const stderrBuffer = createLineBuffer((line) => {
    appendExcerpt(stderrExcerpt, line)
    options.onStderrLine?.(line)
  })

  child.stdout.on('data', (chunk: Buffer) => stdoutBuffer.push(chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => stderrBuffer.push(chunk.toString()))

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
      stdoutBuffer.flush()
      stderrBuffer.flush()
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
        const stderrDetail = stderrExcerpt.length > 0 ? `\nstderr: ${stderrExcerpt.join(' | ')}` : ''
        const stdoutDetail = stdoutExcerpt.length > 0 ? `\nstdout: ${stdoutExcerpt.join(' | ')}` : ''
        reject(
          new Error(
            `Command failed with code ${code}: ${options.command} ${options.args.join(' ')}${stderrDetail}${stdoutDetail}`,
          ),
        )
        return
      }
      resolve({ code: code ?? 0 })
    })
  })
}
