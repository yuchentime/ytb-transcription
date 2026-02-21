import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../channels'
import fs from 'node:fs'
import path from 'node:path'

// 允许读取的音频文件扩展名
const ALLOWED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm']

export function registerFileHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.fileReadAudio, async (_event, filePath: string) => {
    // 验证文件路径
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('Invalid file path')
    }

    // 检查文件扩展名
    const ext = path.extname(filePath).toLowerCase()
    if (!ALLOWED_AUDIO_EXTENSIONS.includes(ext)) {
      throw new Error(`Unsupported audio format: ${ext}`)
    }

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found')
    }

    // 读取文件
    const buffer = fs.readFileSync(filePath)

    // 根据扩展名确定 MIME 类型
    const mimeTypeMap: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.flac': 'audio/flac',
      '.webm': 'audio/webm',
    }

    return {
      data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      mimeType: mimeTypeMap[ext] || 'audio/mpeg',
      fileName: path.basename(filePath),
    }
  })
}
