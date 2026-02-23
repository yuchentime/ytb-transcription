import fs from 'node:fs/promises'
import path from 'node:path'
import { runCommand } from './command'

export interface Toolchain {
  ytDlpPath: string
  ffmpegPath: string
  pythonPath: string
  denoPath: string
  whisperRuntime: {
    cudaAvailable: boolean
    mpsAvailable: boolean
    mlxAvailable: boolean
  }
}

export interface ToolchainRuntimeEvent {
  component: 'yt-dlp' | 'ffmpeg' | 'python' | 'whisper' | 'deno' | 'engine'
  status: 'checking' | 'downloading' | 'installing' | 'ready' | 'error'
  message: string
}

interface EnsureToolchainOptions {
  reporter?: (event: ToolchainRuntimeEvent) => void
}

const NETWORK_REQUEST_TIMEOUT_MS = 20 * 60 * 1000

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = NETWORK_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function getYtDlpBinaryName(): string {
  return process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
}

function getYtDlpDownloadUrl(): string {
  if (process.platform === 'win32') {
    return 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  }
  if (process.platform === 'darwin') {
    return 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
  }
  if (process.platform === 'linux') {
    return 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux'
  }
  return 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
}

async function isLegacyPythonYtDlp(filePath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(filePath, 'r')
    const buffer = Buffer.alloc(256)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const content = buffer.subarray(0, bytesRead).toString('utf8')
    const firstLine = content.split(/\r?\n/, 1)[0] ?? ''
    return firstLine.startsWith('#!') && /python/i.test(firstLine)
  } catch {
    return false
  } finally {
    if (handle) {
      await handle.close()
    }
  }
}

async function probeYtDlp(ytDlpPath: string): Promise<{ ok: boolean; errorMessage?: string }> {
  try {
    await runCommand({
      command: ytDlpPath,
      args: ['--version'],
      timeoutMs: 15_000,
    })
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}

async function removePathIfExists(targetPath: string): Promise<void> {
  try {
    await fs.rm(targetPath, { recursive: true, force: true })
  } catch {
    // ignore removal errors and let follow-up operations report concrete failures
  }
}

async function ensureYtDlp(toolsDir: string, options?: EnsureToolchainOptions): Promise<string> {
  options?.reporter?.({
    component: 'yt-dlp',
    status: 'checking',
    message: 'Checking yt-dlp binary',
  })
  const ytDlpPath = path.join(toolsDir, getYtDlpBinaryName())
  try {
    await fs.access(ytDlpPath)
    const legacyPythonWrapper = await isLegacyPythonYtDlp(ytDlpPath)
    if (legacyPythonWrapper) {
      options?.reporter?.({
        component: 'yt-dlp',
        status: 'installing',
        message: 'Detected legacy Python-based yt-dlp wrapper, upgrading to standalone binary',
      })
      await removePathIfExists(ytDlpPath)
      throw new Error('legacy yt-dlp wrapper detected')
    }

    const probe = await probeYtDlp(ytDlpPath)
    if (!probe.ok) {
      const unsupportedPython = /unsupported version of python/i.test(probe.errorMessage ?? '')
      options?.reporter?.({
        component: 'yt-dlp',
        status: 'installing',
        message: unsupportedPython
          ? 'Cached yt-dlp depends on unsupported Python, reinstalling standalone binary'
          : 'Cached yt-dlp is not runnable, reinstalling',
      })
      await removePathIfExists(ytDlpPath)
      throw new Error('cached yt-dlp not runnable')
    }

    options?.reporter?.({
      component: 'yt-dlp',
      status: 'ready',
      message: `Using cached yt-dlp: ${ytDlpPath}`,
    })
    return ytDlpPath
  } catch {
    // continue to download
  }

  options?.reporter?.({
    component: 'yt-dlp',
    status: 'downloading',
    message: 'Downloading yt-dlp binary',
  })
  try {
    await downloadFile(getYtDlpDownloadUrl(), ytDlpPath)
  } catch (error) {
    const errorMessage = toErrorMessage(error)
    options?.reporter?.({
      component: 'yt-dlp',
      status: 'error',
      message: `yt-dlp download failed: ${errorMessage}`,
    })
    throw new Error(`Failed to download yt-dlp: ${errorMessage}`)
  }
  if (process.platform !== 'win32') {
    await fs.chmod(ytDlpPath, 0o755)
  }

  const probe = await probeYtDlp(ytDlpPath)
  if (!probe.ok) {
    await removePathIfExists(ytDlpPath)
    options?.reporter?.({
      component: 'yt-dlp',
      status: 'error',
      message: `yt-dlp verification failed after download`,
    })
    throw new Error(`yt-dlp downloaded but failed to run: ${probe.errorMessage ?? 'unknown error'}`)
  }

  options?.reporter?.({
    component: 'yt-dlp',
    status: 'ready',
    message: `yt-dlp installed: ${ytDlpPath}`,
  })
  return ytDlpPath
}

function getDenoBinaryName(): string {
  return process.platform === 'win32' ? 'deno.exe' : 'deno'
}

function getDenoDownloadUrl(): string | null {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return 'https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip'
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-apple-darwin.zip'
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip'
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return 'https://github.com/denoland/deno/releases/latest/download/deno-aarch64-unknown-linux-gnu.zip'
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip'
  }
  if (process.platform === 'win32' && process.arch === 'arm64') {
    return 'https://github.com/denoland/deno/releases/latest/download/deno-aarch64-pc-windows-msvc.zip'
  }
  return null
}

async function extractZipArchive(archivePath: string, targetDir: string): Promise<void> {
  if (process.platform === 'win32') {
    await runCommand({
      command: 'powershell',
      args: [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${targetDir}' -Force`,
      ],
    })
    return
  }

  await runCommand({
    command: 'unzip',
    args: ['-o', archivePath, '-d', targetDir],
  })
}

async function findSystemDeno(): Promise<string | null> {
  try {
    await runCommand({
      command: 'deno',
      args: ['--version'],
    })
    return 'deno'
  } catch {
    return null
  }
}

async function ensureDeno(toolsDir: string, options?: EnsureToolchainOptions): Promise<string> {
  options?.reporter?.({
    component: 'deno',
    status: 'checking',
    message: 'Checking JavaScript runtime (deno)',
  })

  const systemDeno = await findSystemDeno()
  if (systemDeno) {
    options?.reporter?.({
      component: 'deno',
      status: 'ready',
      message: 'Using system deno runtime',
    })
    return systemDeno
  }

  const denoDir = path.join(toolsDir, 'deno')
  const denoPath = path.join(denoDir, getDenoBinaryName())
  try {
    await fs.access(denoPath)
    options?.reporter?.({
      component: 'deno',
      status: 'ready',
      message: `Using cached deno runtime: ${denoPath}`,
    })
    return denoPath
  } catch {
    // continue to install
  }

  const downloadUrl = getDenoDownloadUrl()
  if (!downloadUrl) {
    options?.reporter?.({
      component: 'deno',
      status: 'error',
      message: `Unsupported platform for deno: ${process.platform}-${process.arch}`,
    })
    throw new Error(`Unsupported platform for deno auto download: ${process.platform}-${process.arch}`)
  }

  await fs.mkdir(denoDir, { recursive: true })
  const archivePath = path.join(toolsDir, 'deno.zip')

  options?.reporter?.({
    component: 'deno',
    status: 'downloading',
    message: 'Downloading deno runtime',
  })
  try {
    await downloadFile(downloadUrl, archivePath)
  } catch (error) {
    const errorMessage = toErrorMessage(error)
    options?.reporter?.({
      component: 'deno',
      status: 'error',
      message: `deno download failed: ${errorMessage}`,
    })
    throw new Error(`Failed to download deno runtime: ${errorMessage}`)
  }

  options?.reporter?.({
    component: 'deno',
    status: 'installing',
    message: 'Extracting deno runtime',
  })
  try {
    await extractZipArchive(archivePath, denoDir)
  } catch (error) {
    const errorMessage = toErrorMessage(error)
    options?.reporter?.({
      component: 'deno',
      status: 'error',
      message: `deno extraction failed: ${errorMessage}`,
    })
    throw new Error(`Failed to extract deno runtime: ${errorMessage}`)
  } finally {
    await fs.rm(archivePath, { force: true })
  }

  try {
    await fs.access(denoPath)
  } catch {
    options?.reporter?.({
      component: 'deno',
      status: 'error',
      message: 'deno executable not found after extraction',
    })
    throw new Error('deno extracted but executable was not found')
  }

  if (process.platform !== 'win32') {
    await fs.chmod(denoPath, 0o755)
  }

  options?.reporter?.({
    component: 'deno',
    status: 'ready',
    message: `deno runtime ready: ${denoPath}`,
  })
  return denoPath
}

function getFfmpegBinaryName(): string {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

function getFfmpegDownloadUrl(): string | null {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return 'https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-darwin-arm64'
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return 'https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-darwin-x64'
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return 'https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-linux-x64'
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return 'https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-linux-arm64'
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-win32-x64.exe'
  }
  if (process.platform === 'win32' && process.arch === 'ia32') {
    return 'https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-win32-ia32.exe'
  }
  if (process.platform === 'win32' && process.arch === 'arm64') {
    return 'https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-win32-arm64.exe'
  }
  return null
}

async function ensureFfmpeg(toolsDir: string, options?: EnsureToolchainOptions): Promise<string> {
  options?.reporter?.({
    component: 'ffmpeg',
    status: 'checking',
    message: 'Checking ffmpeg binary',
  })
  try {
    await runCommand({
      command: 'ffmpeg',
      args: ['-version'],
    })
    options?.reporter?.({
      component: 'ffmpeg',
      status: 'ready',
      message: 'Using system ffmpeg',
    })
    return 'ffmpeg'
  } catch {
    // fallback to downloaded binary
  }

  const ffmpegPath = path.join(toolsDir, getFfmpegBinaryName())
  try {
    await fs.access(ffmpegPath)
    options?.reporter?.({
      component: 'ffmpeg',
      status: 'ready',
      message: `Using cached ffmpeg: ${ffmpegPath}`,
    })
    return ffmpegPath
  } catch {
    // continue to download
  }

  const url = getFfmpegDownloadUrl()
  if (!url) {
    options?.reporter?.({
      component: 'ffmpeg',
      status: 'error',
      message: `Unsupported platform for ffmpeg: ${process.platform}-${process.arch}`,
    })
    throw new Error(`Unsupported platform for ffmpeg auto download: ${process.platform}-${process.arch}`)
  }

  options?.reporter?.({
    component: 'ffmpeg',
    status: 'downloading',
    message: 'Downloading ffmpeg binary',
  })
  try {
    await downloadFile(url, ffmpegPath)
  } catch (error) {
    const errorMessage = toErrorMessage(error)
    options?.reporter?.({
      component: 'ffmpeg',
      status: 'error',
      message: `ffmpeg download failed: ${errorMessage}`,
    })
    throw new Error(`Failed to download ffmpeg: ${errorMessage}`)
  }
  if (process.platform !== 'win32') {
    await fs.chmod(ffmpegPath, 0o755)
  }
  options?.reporter?.({
    component: 'ffmpeg',
    status: 'ready',
    message: `ffmpeg installed: ${ffmpegPath}`,
  })
  return ffmpegPath
}

const MIN_SUPPORTED_PYTHON = {
  major: 3,
  minor: 10,
} as const

interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
}

interface GitHubRelease {
  assets?: GitHubReleaseAsset[]
}

function getPortablePythonArchToken(): string | null {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'aarch64-apple-darwin'
  if (process.platform === 'darwin' && process.arch === 'x64') return 'x86_64-apple-darwin'
  if (process.platform === 'linux' && process.arch === 'x64') return 'x86_64-unknown-linux-gnu'
  if (process.platform === 'linux' && process.arch === 'arm64') return 'aarch64-unknown-linux-gnu'
  if (process.platform === 'win32' && process.arch === 'x64') return 'x86_64-pc-windows-msvc'
  if (process.platform === 'win32' && process.arch === 'arm64') return 'aarch64-pc-windows-msvc'
  return null
}

async function resolvePortablePythonAssetUrl(): Promise<string> {
  const archToken = getPortablePythonArchToken()
  if (!archToken) {
    throw new Error(`Portable Python not supported on ${process.platform}-${process.arch}`)
  }

  const api = 'https://api.github.com/repos/indygreg/python-build-standalone/releases/latest'
  const response = await fetchWithTimeout(api, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to query python-build-standalone release: HTTP ${response.status}`)
  }

  const release = (await response.json()) as GitHubRelease
  const assets = release.assets ?? []
  const preferred = assets.find(
    (asset) =>
      asset.name.includes(archToken) &&
      asset.name.includes('install_only') &&
      asset.name.endsWith('.tar.gz'),
  )
  if (preferred) return preferred.browser_download_url

  const fallback = assets.find(
    (asset) => asset.name.includes(archToken) && asset.name.endsWith('.tar.gz'),
  )
  if (fallback) return fallback.browser_download_url

  throw new Error(`No portable Python artifact found for token: ${archToken}`)
}

async function downloadFile(url: string, filePath: string): Promise<void> {
  const response = await fetchWithTimeout(url)
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`)
  }
  const content = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(filePath, content)
}

async function extractTarGz(archivePath: string, targetDir: string): Promise<void> {
  await runCommand({
    command: 'tar',
    args: ['-xzf', archivePath, '-C', targetDir],
  })
}

async function findPortablePythonBinary(portableDir: string): Promise<string | null> {
  const candidates = process.platform === 'win32'
    ? [
        path.join(portableDir, 'python.exe'),
        path.join(portableDir, 'install', 'python.exe'),
        path.join(portableDir, 'python', 'python.exe'),
      ]
    : [
        path.join(portableDir, 'bin', 'python3'),
        path.join(portableDir, 'install', 'bin', 'python3'),
        path.join(portableDir, 'python', 'bin', 'python3'),
      ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // continue
    }
  }
  return null
}

async function getPythonVersion(pythonPath: string): Promise<{ major: number; minor: number; patch: number } | null> {
  const lines: string[] = []
  try {
    await runCommand({
      command: pythonPath,
      args: ['-c', 'import sys;print(f"{sys.version_info[0]}.{sys.version_info[1]}.{sys.version_info[2]}")'],
      timeoutMs: 15_000,
      onStdoutLine: (line) => lines.push(line),
    })
  } catch {
    return null
  }

  const raw = lines[lines.length - 1] ?? ''
  const match = raw.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function isPythonVersionSupported(version: { major: number; minor: number }): boolean {
  if (version.major > MIN_SUPPORTED_PYTHON.major) return true
  if (version.major < MIN_SUPPORTED_PYTHON.major) return false
  return version.minor >= MIN_SUPPORTED_PYTHON.minor
}

async function installPortablePython(toolsDir: string, options?: EnsureToolchainOptions): Promise<string> {
  options?.reporter?.({
    component: 'python',
    status: 'checking',
    message: 'Checking managed Python runtime',
  })
  const portableDir = path.join(toolsDir, 'python-portable')
  await fs.mkdir(portableDir, { recursive: true })

  const existing = await findPortablePythonBinary(portableDir)
  if (existing) {
    const version = await getPythonVersion(existing)
    if (version && isPythonVersionSupported(version)) {
      options?.reporter?.({
        component: 'python',
        status: 'ready',
        message: `Using cached managed Python: ${existing} (${version.major}.${version.minor}.${version.patch})`,
      })
      return existing
    }

    options?.reporter?.({
      component: 'python',
      status: 'installing',
      message: 'Cached managed Python is missing or unsupported, reinstalling',
    })
    await fs.rm(portableDir, { recursive: true, force: true })
    await fs.mkdir(portableDir, { recursive: true })
  }

  options?.reporter?.({
    component: 'python',
    status: 'downloading',
    message: 'Downloading managed Python runtime',
  })
  let downloadUrl = ''
  try {
    downloadUrl = await resolvePortablePythonAssetUrl()
  } catch (error) {
    const errorMessage = toErrorMessage(error)
    options?.reporter?.({
      component: 'python',
      status: 'error',
      message: `Managed Python artifact resolve failed: ${errorMessage}`,
    })
    throw new Error(`Failed to resolve managed Python artifact: ${errorMessage}`)
  }
  const archivePath = path.join(toolsDir, 'python-portable.tar.gz')
  try {
    await downloadFile(downloadUrl, archivePath)
  } catch (error) {
    const errorMessage = toErrorMessage(error)
    options?.reporter?.({
      component: 'python',
      status: 'error',
      message: `Managed Python download failed: ${errorMessage}`,
    })
    throw new Error(`Failed to download managed Python runtime: ${errorMessage}`)
  }
  options?.reporter?.({
    component: 'python',
    status: 'installing',
    message: 'Extracting portable Python runtime',
  })
  try {
    await extractTarGz(archivePath, portableDir)
  } catch (error) {
    const errorMessage = toErrorMessage(error)
    options?.reporter?.({
      component: 'python',
      status: 'error',
      message: `Managed Python extraction failed: ${errorMessage}`,
    })
    throw new Error(`Failed to extract managed Python runtime: ${errorMessage}`)
  } finally {
    await fs.rm(archivePath, { force: true })
  }

  const installed = await findPortablePythonBinary(portableDir)
  if (!installed) {
    options?.reporter?.({
      component: 'python',
      status: 'error',
      message: 'Portable Python executable not found after extraction',
    })
    throw new Error('Portable Python extracted but executable was not found')
  }
  if (process.platform !== 'win32') {
    await fs.chmod(installed, 0o755)
  }

  const version = await getPythonVersion(installed)
  if (!version || !isPythonVersionSupported(version)) {
    options?.reporter?.({
      component: 'python',
      status: 'error',
      message: 'Managed Python version is unsupported after install',
    })
    throw new Error(
      `Managed Python must be >= ${MIN_SUPPORTED_PYTHON.major}.${MIN_SUPPORTED_PYTHON.minor}, got ${version ? `${version.major}.${version.minor}.${version.patch}` : 'unknown'}`,
    )
  }

  options?.reporter?.({
    component: 'python',
    status: 'ready',
    message: `Managed Python installed: ${installed} (${version.major}.${version.minor}.${version.patch})`,
  })
  return installed
}

async function findOrInstallPython(toolsDir: string, options?: EnsureToolchainOptions): Promise<string> {
  options?.reporter?.({
    component: 'python',
    status: 'checking',
    message: 'Preparing managed Python runtime',
  })
  return await installPortablePython(toolsDir, options)
}

function getVenvPythonPath(venvDir: string): string {
  if (process.platform === 'win32') {
    return path.join(venvDir, 'Scripts', 'python.exe')
  }
  return path.join(venvDir, 'bin', 'python')
}

async function ensureWhisperInstalled(
  toolsDir: string,
  bootstrapPython: string,
  options?: EnsureToolchainOptions,
): Promise<string> {
  options?.reporter?.({
    component: 'whisper',
    status: 'checking',
    message: 'Preparing whisper runtime environment',
  })
  const venvDir = path.join(toolsDir, 'py-whisper')
  const venvPython = getVenvPythonPath(venvDir)
  const bootstrapMarkerPath = path.join(venvDir, '.bootstrap-python-path')
  let shouldCreateVenv = false

  try {
    await fs.access(venvPython)
  } catch {
    shouldCreateVenv = true
  }

  if (!shouldCreateVenv) {
    try {
      const marker = (await fs.readFile(bootstrapMarkerPath, 'utf8')).trim()
      if (marker !== bootstrapPython) {
        options?.reporter?.({
          component: 'whisper',
          status: 'installing',
          message: 'Refreshing whisper venv to use managed Python runtime',
        })
        await fs.rm(venvDir, { recursive: true, force: true })
        shouldCreateVenv = true
      }
    } catch {
      options?.reporter?.({
        component: 'whisper',
        status: 'installing',
        message: 'Refreshing whisper venv to managed runtime',
      })
      await fs.rm(venvDir, { recursive: true, force: true })
      shouldCreateVenv = true
    }
  }

  if (shouldCreateVenv) {
    options?.reporter?.({
      component: 'whisper',
      status: 'installing',
      message: 'Creating Python venv for whisper',
    })
    await runCommand({
      command: bootstrapPython,
      args: ['-m', 'venv', venvDir],
    })
    await fs.writeFile(bootstrapMarkerPath, bootstrapPython, 'utf8')
  }

  let openaiWhisperInstalled = false
  try {
    await runCommand({
      command: venvPython,
      args: ['-m', 'pip', 'show', 'openai-whisper'],
    })
    openaiWhisperInstalled = true
    options?.reporter?.({
      component: 'whisper',
      status: 'ready',
      message: 'openai-whisper package already installed',
    })
  } catch {
    // install below
  }

  if (!openaiWhisperInstalled) {
    options?.reporter?.({
      component: 'whisper',
      status: 'installing',
      message: 'Installing openai-whisper package',
    })
    await runCommand({
      command: venvPython,
      args: ['-m', 'pip', 'install', '--upgrade', 'pip'],
    })
    await runCommand({
      command: venvPython,
      args: ['-m', 'pip', 'install', 'openai-whisper'],
    })
  }

  if (process.platform === 'darwin' && process.arch === 'arm64') {
    try {
      await runCommand({
        command: venvPython,
        args: ['-m', 'pip', 'show', 'mlx-whisper'],
      })
      options?.reporter?.({
        component: 'whisper',
        status: 'ready',
        message: 'mlx-whisper package already installed',
      })
    } catch {
      options?.reporter?.({
        component: 'whisper',
        status: 'installing',
        message: 'Installing mlx-whisper (Apple Silicon acceleration)',
      })
      try {
        await runCommand({
          command: venvPython,
          args: ['-m', 'pip', 'install', 'mlx-whisper'],
        })
      } catch {
        options?.reporter?.({
          component: 'whisper',
          status: 'error',
          message: 'mlx-whisper install failed; fallback to openai-whisper backend',
        })
      }
    }
  }

  options?.reporter?.({
    component: 'whisper',
    status: 'ready',
    message: 'whisper environment ready',
  })
  return venvPython
}

async function detectWhisperRuntime(
  whisperPython: string,
  options?: EnsureToolchainOptions,
): Promise<Toolchain['whisperRuntime']> {
  const lines: string[] = []
  try {
    await runCommand({
      command: whisperPython,
      args: [
        '-c',
        [
          'import json',
          'import torch',
          'import importlib.util',
          'mps = bool(hasattr(torch.backends, "mps") and torch.backends.mps.is_available())',
          'mlx = importlib.util.find_spec("mlx_whisper") is not None',
          'print(json.dumps({"cuda": bool(torch.cuda.is_available()), "mps": mps, "mlx": mlx}))',
        ].join('; '),
      ],
      onStdoutLine: (line) => lines.push(line),
    })
  } catch {
    options?.reporter?.({
      component: 'whisper',
      status: 'error',
      message: 'Failed to detect whisper runtime capabilities, fallback to CPU',
    })
    return {
      cudaAvailable: false,
      mpsAvailable: false,
      mlxAvailable: false,
    }
  }

  const raw = lines[lines.length - 1] ?? '{}'
  try {
    const parsed = JSON.parse(raw) as { cuda?: unknown; mps?: unknown; mlx?: unknown }
    const runtime = {
      cudaAvailable: parsed.cuda === true,
      mpsAvailable: parsed.mps === true,
      mlxAvailable: parsed.mlx === true,
    }
    options?.reporter?.({
      component: 'whisper',
      status: 'ready',
      message: `whisper runtime: cuda=${runtime.cudaAvailable ? 'yes' : 'no'}, mps=${runtime.mpsAvailable ? 'yes' : 'no'}, mlx=${runtime.mlxAvailable ? 'yes' : 'no'}`,
    })
    return runtime
  } catch {
    options?.reporter?.({
      component: 'whisper',
      status: 'error',
      message: 'Invalid whisper runtime probe output, fallback to CPU',
    })
    return {
      cudaAvailable: false,
      mpsAvailable: false,
      mlxAvailable: false,
    }
  }
}

let toolchainCache: Toolchain | null = null

export async function ensureToolchain(dataRoot: string, options?: EnsureToolchainOptions): Promise<Toolchain> {
  if (toolchainCache) {
    options?.reporter?.({
      component: 'engine',
      status: 'ready',
      message: 'Runtime toolchain already initialized',
    })
    return toolchainCache
  }

  const toolsDir = path.join(dataRoot, 'tools')
  await fs.mkdir(toolsDir, { recursive: true })

  const ytDlpPath = await ensureYtDlp(toolsDir, options)
  const denoPath = await ensureDeno(toolsDir, options)
  const ffmpegPath = await ensureFfmpeg(toolsDir, options)
  const bootstrapPython = await findOrInstallPython(toolsDir, options)
  const pythonPath = await ensureWhisperInstalled(toolsDir, bootstrapPython, options)
  const whisperRuntime = await detectWhisperRuntime(pythonPath, options)

  toolchainCache = {
    ytDlpPath,
    denoPath,
    ffmpegPath,
    pythonPath,
    whisperRuntime,
  }
  return toolchainCache
}
