import fs from 'node:fs/promises'
import path from 'node:path'
import type { AppSettings } from '../db/types'
import { runCommand } from '../task-engine/command'

const PIPER_RELEASE_API = 'https://api.github.com/repos/OHF-Voice/piper1-gpl/releases/latest'
const PIPER_RELEASE_PAGE = 'https://github.com/OHF-Voice/piper1-gpl/releases/latest'
const PIPER_PYPI_JSON = 'https://pypi.org/pypi/piper-tts/json'
const PYTHON_STANDALONE_RELEASE_API =
  'https://api.github.com/repos/indygreg/python-build-standalone/releases/latest'
const PYTHON_STANDALONE_RELEASE_PAGE =
  'https://github.com/indygreg/python-build-standalone/releases/latest'
const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'YTB2Voice',
} as const

const MIN_SUPPORTED_PYTHON = {
  major: 3,
  minor: 10,
} as const

interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
}

interface GitHubRelease {
  tag_name?: string
  assets?: GitHubReleaseAsset[]
}

interface PypiReleaseFile {
  filename?: string
  url?: string
}

interface PypiProjectResponse {
  info?: {
    version?: string
  }
  releases?: Record<string, PypiReleaseFile[]>
}

export interface InstallPiperRuntimeInput {
  dataRoot: string
  settings: AppSettings
  forceReinstall?: boolean
}

export interface InstallPiperRuntimeResult {
  releaseTag: string
  voice: string
  piperExecutablePath: string
  piperModelPath: string
  piperConfigPath: string
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function fetchRelease(url: string): Promise<GitHubRelease> {
  const response = await fetch(url, { headers: GITHUB_HEADERS })
  if (!response.ok) {
    throw new Error(`请求 GitHub Release 失败: HTTP ${response.status}`)
  }
  return (await response.json()) as GitHubRelease
}

function parseReleaseTagFromUrl(url: string): string | null {
  const matched = /\/releases\/tag\/([^/?#]+)/.exec(url)
  return matched ? decodeURIComponent(matched[1]) : null
}

function normalizeGithubAssetUrl(href: string): string {
  const normalized = href.replace(/&amp;/g, '&')
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized
  }
  return `https://github.com${normalized}`
}

function parseReleaseAssetsFromHtml(html: string): GitHubReleaseAsset[] {
  const seen = new Set<string>()
  const assets: GitHubReleaseAsset[] = []
  const pattern = /href="([^"]*\/releases\/download\/[^"]+)"/g
  let matched = pattern.exec(html)

  while (matched) {
    const downloadUrl = normalizeGithubAssetUrl(matched[1])
    if (!seen.has(downloadUrl)) {
      seen.add(downloadUrl)
      const pathname = new URL(downloadUrl).pathname
      assets.push({
        name: decodeURIComponent(path.basename(pathname)),
        browser_download_url: downloadUrl,
      })
    }
    matched = pattern.exec(html)
  }

  return assets
}

async function fetchReleaseFromHtml(latestReleasePage: string): Promise<GitHubRelease> {
  const latestPage = await fetch(latestReleasePage, { headers: GITHUB_HEADERS })
  if (!latestPage.ok) {
    throw new Error(`请求 GitHub Release 页面失败: HTTP ${latestPage.status}`)
  }

  const tag = parseReleaseTagFromUrl(latestPage.url)
  if (!tag) {
    throw new Error(`无法从 URL 解析 Release 标签: ${latestPage.url}`)
  }

  const expandedAssetsUrl = latestPage.url.replace('/releases/tag/', '/releases/expanded_assets/')
  const expandedPage = await fetch(expandedAssetsUrl, { headers: GITHUB_HEADERS })
  if (!expandedPage.ok) {
    throw new Error(`请求 GitHub Release 资源列表失败: HTTP ${expandedPage.status}`)
  }

  const assets = parseReleaseAssetsFromHtml(await expandedPage.text())
  if (assets.length === 0) {
    throw new Error('Release 资源列表为空')
  }

  return {
    tag_name: tag,
    assets,
  }
}

async function fetchReleaseWithFallback(apiUrl: string, latestReleasePage: string): Promise<GitHubRelease> {
  try {
    return await fetchRelease(apiUrl)
  } catch (apiError) {
    try {
      return await fetchReleaseFromHtml(latestReleasePage)
    } catch (htmlError) {
      const apiMessage = apiError instanceof Error ? apiError.message : String(apiError)
      const htmlMessage = htmlError instanceof Error ? htmlError.message : String(htmlError)
      throw new Error(`${apiMessage}; 备用解析失败: ${htmlMessage}`)
    }
  }
}

async function downloadFile(url: string, filePath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status} (${url})`)
  }
  const content = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(filePath, content)
}

function getPiperWheelTokens(): string[] | null {
  if (process.platform === 'darwin' && process.arch === 'arm64') return ['macosx_11_0_arm64']
  if (process.platform === 'darwin' && process.arch === 'x64') return ['macosx_10_9_x86_64']
  if (process.platform === 'linux' && process.arch === 'x64') {
    return ['manylinux_2_17_x86_64', 'manylinux2014_x86_64']
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return ['manylinux_2_17_aarch64', 'manylinux2014_aarch64']
  }
  if (process.platform === 'win32' && process.arch === 'x64') return ['win_amd64']
  return null
}

async function resolvePiperWheelAsset(): Promise<{
  releaseTag: string
  asset: GitHubReleaseAsset
}> {
  const tokens = getPiperWheelTokens()
  if (!tokens) {
    throw new Error(`当前平台暂不支持自动安装 Piper: ${process.platform}-${process.arch}`)
  }

  try {
    const response = await fetch(PIPER_PYPI_JSON, { headers: { 'User-Agent': GITHUB_HEADERS['User-Agent'] } })
    if (!response.ok) {
      throw new Error(`请求 PyPI 失败: HTTP ${response.status}`)
    }
    const payload = (await response.json()) as PypiProjectResponse
    const latestVersion = payload.info?.version?.trim()
    if (!latestVersion) {
      throw new Error('PyPI 返回的版本信息为空')
    }
    const releaseFiles = payload.releases?.[latestVersion] ?? []
    const wheelAssets = releaseFiles
      .filter(
        (item): item is Required<PypiReleaseFile> =>
          typeof item.filename === 'string' &&
          item.filename.endsWith('.whl') &&
          typeof item.url === 'string' &&
          item.url.length > 0,
      )
      .map((item) => ({
        name: item.filename,
        browser_download_url: item.url,
      }))
    const matched = wheelAssets.find((asset) => tokens.some((token) => asset.name.includes(token)))
    if (matched) {
      return {
        releaseTag: `v${latestVersion}`,
        asset: matched,
      }
    }
  } catch (error) {
    void error
  }

  const release = await fetchReleaseWithFallback(PIPER_RELEASE_API, PIPER_RELEASE_PAGE)
  const assets = release.assets ?? []
  const wheelAssets = assets.filter((asset) => asset.name.endsWith('.whl'))
  const matched = wheelAssets.find((asset) => tokens.some((token) => asset.name.includes(token)))
  if (!matched) {
    throw new Error(`未找到当前平台对应的 Piper 安装包，平台标识: ${tokens.join(', ')}`)
  }

  return {
    releaseTag: release.tag_name ?? 'latest',
    asset: matched,
  }
}

function isPythonVersionSupported(version: { major: number; minor: number }): boolean {
  if (version.major > MIN_SUPPORTED_PYTHON.major) return true
  if (version.major < MIN_SUPPORTED_PYTHON.major) return false
  return version.minor >= MIN_SUPPORTED_PYTHON.minor
}

async function getPythonVersion(command: string): Promise<{ major: number; minor: number } | null> {
  const lines: string[] = []
  try {
    await runCommand({
      command,
      args: ['-c', 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")'],
      onStdoutLine: (line) => lines.push(line),
      timeoutMs: 8000,
    })
    const raw = lines[lines.length - 1] ?? ''
    const match = /^(\d+)\.(\d+)$/.exec(raw.trim())
    if (!match) return null
    return {
      major: Number(match[1]),
      minor: Number(match[2]),
    }
  } catch {
    return null
  }
}

async function findSystemPython(): Promise<string | null> {
  const candidates = process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python']
  for (const candidate of candidates) {
    const version = await getPythonVersion(candidate)
    if (version && isPythonVersionSupported(version)) {
      return candidate
    }
  }
  return null
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

async function resolvePortablePythonDownloadUrl(): Promise<string> {
  const archToken = getPortablePythonArchToken()
  if (!archToken) {
    throw new Error(`当前平台无法自动安装 Python: ${process.platform}-${process.arch}`)
  }

  const release = await fetchReleaseWithFallback(
    PYTHON_STANDALONE_RELEASE_API,
    PYTHON_STANDALONE_RELEASE_PAGE,
  )
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

  throw new Error(`未找到当前平台可用的 Python 安装包: ${archToken}`)
}

async function extractTarGz(archivePath: string, targetDir: string): Promise<void> {
  await runCommand({
    command: 'tar',
    args: ['-xzf', archivePath, '-C', targetDir],
    timeoutMs: 10 * 60 * 1000,
  })
}

async function findPortablePythonBinary(portableDir: string): Promise<string | null> {
  const candidates =
    process.platform === 'win32'
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
    if (await pathExists(candidate)) {
      return candidate
    }
  }
  return null
}

async function installPortablePython(toolsDir: string): Promise<string> {
  const portableDir = path.join(toolsDir, 'python-portable')
  await fs.mkdir(portableDir, { recursive: true })

  const existing = await findPortablePythonBinary(portableDir)
  if (existing) {
    const version = await getPythonVersion(existing)
    if (version && isPythonVersionSupported(version)) {
      return existing
    }
    await fs.rm(portableDir, { recursive: true, force: true })
    await fs.mkdir(portableDir, { recursive: true })
  }

  const downloadUrl = await resolvePortablePythonDownloadUrl()
  const archivePath = path.join(toolsDir, 'python-portable.tar.gz')
  await downloadFile(downloadUrl, archivePath)
  await extractTarGz(archivePath, portableDir)
  await fs.rm(archivePath, { force: true })

  const installed = await findPortablePythonBinary(portableDir)
  if (!installed) {
    throw new Error('Python 解压完成，但未找到可执行文件')
  }
  if (process.platform !== 'win32') {
    await fs.chmod(installed, 0o755).catch(() => undefined)
  }
  return installed
}

async function ensureBootstrapPython(dataRoot: string): Promise<string> {
  const systemPython = await findSystemPython()
  if (systemPython) return systemPython
  const toolsDir = path.join(dataRoot, 'tools')
  await fs.mkdir(toolsDir, { recursive: true })
  return await installPortablePython(toolsDir)
}

function getVenvPythonPath(venvDir: string): string {
  if (process.platform === 'win32') {
    return path.join(venvDir, 'Scripts', 'python.exe')
  }
  return path.join(venvDir, 'bin', 'python')
}

function getPiperExecutablePath(venvDir: string): string {
  if (process.platform === 'win32') {
    return path.join(venvDir, 'Scripts', 'piper.exe')
  }
  return path.join(venvDir, 'bin', 'piper')
}

async function ensurePiperVenv(dataRoot: string, bootstrapPython: string): Promise<{
  venvDir: string
  venvPython: string
  piperExecutablePath: string
}> {
  const venvDir = path.join(dataRoot, 'piper', 'venv')
  await fs.mkdir(venvDir, { recursive: true })
  const venvPython = getVenvPythonPath(venvDir)
  const bootstrapMarkerPath = path.join(venvDir, '.bootstrap-python-path')
  let shouldCreateVenv = !(await pathExists(venvPython))

  if (!shouldCreateVenv) {
    const venvPythonVersion = await getPythonVersion(venvPython)
    if (!venvPythonVersion || !isPythonVersionSupported(venvPythonVersion)) {
      await fs.rm(venvDir, { recursive: true, force: true })
      await fs.mkdir(venvDir, { recursive: true })
      shouldCreateVenv = true
    }
  }

  if (!shouldCreateVenv) {
    try {
      const marker = (await fs.readFile(bootstrapMarkerPath, 'utf8')).trim()
      if (marker !== bootstrapPython) {
        await fs.rm(venvDir, { recursive: true, force: true })
        await fs.mkdir(venvDir, { recursive: true })
        shouldCreateVenv = true
      }
    } catch {
      await fs.rm(venvDir, { recursive: true, force: true })
      await fs.mkdir(venvDir, { recursive: true })
      shouldCreateVenv = true
    }
  }

  if (shouldCreateVenv) {
    await runCommand({
      command: bootstrapPython,
      args: ['-m', 'venv', venvDir],
      timeoutMs: 10 * 60 * 1000,
    })
    await fs.writeFile(bootstrapMarkerPath, bootstrapPython, 'utf8')
  }

  const piperExecutablePath = getPiperExecutablePath(venvDir)
  return {
    venvDir,
    venvPython,
    piperExecutablePath,
  }
}

async function installPiperPackage(params: {
  venvPython: string
  downloadsDir: string
  forceReinstall: boolean
}): Promise<{ releaseTag: string }> {
  const { releaseTag, asset } = await resolvePiperWheelAsset()
  await fs.mkdir(params.downloadsDir, { recursive: true })
  const wheelPath = path.join(params.downloadsDir, asset.name)

  if (params.forceReinstall || !(await pathExists(wheelPath))) {
    await downloadFile(asset.browser_download_url, wheelPath)
  }

  await runCommand({
    command: params.venvPython,
    args: ['-m', 'pip', 'install', '--upgrade', 'pip'],
    timeoutMs: 10 * 60 * 1000,
  })

  const installArgs = params.forceReinstall
    ? ['-m', 'pip', 'install', '--upgrade', '--force-reinstall', wheelPath]
    : ['-m', 'pip', 'install', '--upgrade', wheelPath]

  await runCommand({
    command: params.venvPython,
    args: installArgs,
    timeoutMs: 20 * 60 * 1000,
  })

  const hasPathvalidate = await (async () => {
    try {
      await runCommand({
        command: params.venvPython,
        args: ['-m', 'pip', 'show', 'pathvalidate'],
        timeoutMs: 20_000,
      })
      return true
    } catch {
      return false
    }
  })()
  if (!hasPathvalidate) {
    await runCommand({
      command: params.venvPython,
      args: ['-m', 'pip', 'install', 'pathvalidate'],
      timeoutMs: 5 * 60 * 1000,
    })
  }

  await runCommand({
    command: params.venvPython,
    args: [
      '-m',
      'pip',
      'install',
      '--upgrade',
      'g2pw',
      'sentence-stream',
      'unicode-rbnf',
      'requests',
      'torch',
    ],
    timeoutMs: 30 * 60 * 1000,
  })

  return { releaseTag }
}

async function listPiperVoices(venvPython: string): Promise<string[]> {
  const voices: string[] = []
  await runCommand({
    command: venvPython,
    args: ['-m', 'piper.download_voices'],
    timeoutMs: 2 * 60 * 1000,
    onStdoutLine: (line) => {
      if (/^[a-z]{2,3}_[a-z]{2,3}-.+-.+$/i.test(line)) {
        voices.push(line.trim())
      }
    },
  })
  return Array.from(new Set(voices)).sort((a, b) => a.localeCompare(b))
}

function deriveVoiceFromModelPath(modelPath: string): string {
  const ext = path.extname(modelPath)
  return ext ? path.basename(modelPath, ext) : path.basename(modelPath)
}

function pickVoiceByLanguage(voices: string[], language: AppSettings['defaultTargetLanguage']): string {
  if (voices.length === 0) {
    throw new Error('Piper voice 列表为空，无法自动下载模型')
  }

  const patternGroups: Record<AppSettings['defaultTargetLanguage'], RegExp[]> = {
    zh: [/^zh_CN-[^-]+-medium$/i, /^zh_CN-/i],
    en: [/^en_US-lessac-medium$/i, /^en_US-[^-]+-medium$/i, /^en_US-/i],
    ja: [/^ja_JP-[^-]+-medium$/i, /^ja_JP-/i, /^ja_/i],
  }

  for (const pattern of patternGroups[language]) {
    const found = voices.find((voice) => pattern.test(voice))
    if (found) return found
  }

  const availableSamples = voices.slice(0, 8).join(', ')
  throw new Error(
    `未找到支持语言 "${language}" 的 Piper 音色，请先下载对应语言模型。当前可用音色: ${availableSamples}`,
  )
}

async function ensureVoiceModel(params: {
  venvPython: string
  modelsDir: string
  settings: AppSettings
  forceReinstall: boolean
}): Promise<{ voice: string; modelPath: string; configPath: string }> {
  await fs.mkdir(params.modelsDir, { recursive: true })
  const configuredModelPath = params.settings.piperModelPath.trim()
  if (!params.forceReinstall && configuredModelPath) {
    const configuredConfigPathRaw = params.settings.piperConfigPath.trim()
    const configuredConfigPath = configuredConfigPathRaw || `${configuredModelPath}.json`
    if ((await pathExists(configuredModelPath)) && (await pathExists(configuredConfigPath))) {
      return {
        voice: deriveVoiceFromModelPath(configuredModelPath),
        modelPath: configuredModelPath,
        configPath: configuredConfigPath,
      }
    }
  }

  const voices = await listPiperVoices(params.venvPython)
  const voice = pickVoiceByLanguage(voices, params.settings.defaultTargetLanguage)
  const modelPath = path.join(params.modelsDir, `${voice}.onnx`)
  const configPath = `${modelPath}.json`

  if (
    params.forceReinstall ||
    !(await pathExists(modelPath)) ||
    !(await pathExists(configPath))
  ) {
    const args = ['-m', 'piper.download_voices', '--download-dir', params.modelsDir, voice]
    if (params.forceReinstall) {
      args.splice(4, 0, '--force-redownload')
    }
    await runCommand({
      command: params.venvPython,
      args,
      timeoutMs: 20 * 60 * 1000,
    })
  }

  if (!(await pathExists(modelPath))) {
    throw new Error(`Piper 模型下载完成后未找到文件: ${modelPath}`)
  }
  if (!(await pathExists(configPath))) {
    throw new Error(`Piper 配置下载完成后未找到文件: ${configPath}`)
  }

  return { voice, modelPath, configPath }
}

export async function installPiperRuntime(
  input: InstallPiperRuntimeInput,
): Promise<InstallPiperRuntimeResult> {
  const bootstrapPython = await ensureBootstrapPython(input.dataRoot)
  const { venvPython, piperExecutablePath } = await ensurePiperVenv(input.dataRoot, bootstrapPython)
  const downloadsDir = path.join(input.dataRoot, 'piper', 'downloads')
  const modelsDir = path.join(input.dataRoot, 'piper', 'models')

  const forceReinstall = input.forceReinstall === true
  const { releaseTag } = await installPiperPackage({
    venvPython,
    downloadsDir,
    forceReinstall,
  })

  if (!(await pathExists(piperExecutablePath))) {
    throw new Error(`Piper 安装完成后未找到可执行文件: ${piperExecutablePath}`)
  }
  if (process.platform !== 'win32') {
    await fs.chmod(piperExecutablePath, 0o755).catch(() => undefined)
  }

  const { voice, modelPath, configPath } = await ensureVoiceModel({
    venvPython,
    modelsDir,
    settings: input.settings,
    forceReinstall,
  })

  return {
    releaseTag,
    voice,
    piperExecutablePath,
    piperModelPath: modelPath,
    piperConfigPath: configPath,
  }
}
