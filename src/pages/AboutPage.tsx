import { useCallback, useEffect, useState } from 'react'
import type { TranslateFn } from '../app/i18n'
import type { UpdateStatusPayload } from '../../electron/ipc/channels'

interface AboutPageProps {
  t: TranslateFn
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'

export function AboutPage(props: AboutPageProps) {
  const { t } = props
  const [version, setVersion] = useState<string>('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle')
  const [updateVersion, setUpdateVersion] = useState<string>('')
  const [downloadProgress, setDownloadProgress] = useState<number>(0)

  useEffect(() => {
    // Get current app version
    window.appApi.update.getVersion().then(setVersion)

    // Subscribe to update status
    const unsubscribe = window.appApi.update.onStatus((payload: UpdateStatusPayload) => {
      setUpdateStatus(payload.status)
      if (payload.data) {
        if (payload.data.version) {
          setUpdateVersion(payload.data.version)
        }
        if (payload.data.percent !== undefined) {
          setDownloadProgress(payload.data.percent)
        }
      }
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const handleCheckUpdate = useCallback(async () => {
    setUpdateStatus('checking')
    await window.appApi.update.check()
  }, [])

  const handleDownloadUpdate = useCallback(async () => {
    setUpdateStatus('downloading')
    await window.appApi.update.download()
  }, [])

  const handleInstallUpdate = useCallback(() => {
    window.appApi.update.install()
  }, [])

  const renderUpdateButton = () => {
    switch (updateStatus) {
      case 'idle':
      case 'not-available':
        return (
          <button className="btn btn-secondary" onClick={handleCheckUpdate}>
            检查更新
          </button>
        )
      case 'checking':
        return (
          <button className="btn btn-secondary" disabled>
            检查中...
          </button>
        )
      case 'available':
        return (
          <button className="btn btn-primary" onClick={handleDownloadUpdate}>
            下载新版本 {updateVersion}
          </button>
        )
      case 'downloading':
        return (
          <button className="btn btn-secondary" disabled>
            下载中 {downloadProgress.toFixed(0)}%
          </button>
        )
      case 'downloaded':
        return (
          <button className="btn btn-primary" onClick={handleInstallUpdate}>
            安装更新并重启
          </button>
        )
      case 'error':
        return (
          <button className="btn btn-secondary" onClick={handleCheckUpdate}>
            重试
          </button>
        )
      default:
        return null
    }
  }

  const getUpdateStatusText = () => {
    switch (updateStatus) {
      case 'idle':
        return ''
      case 'checking':
        return '正在检查更新...'
      case 'available':
        return `发现新版本 ${updateVersion}`
      case 'downloading':
        return `下载中 ${downloadProgress.toFixed(0)}%`
      case 'downloaded':
        return '更新已下载，点击安装'
      case 'not-available':
        return '已是最新版本'
      case 'error':
        return '检查更新失败'
      default:
        return ''
    }
  }

  return (
    <section className="panel main-panel about-panel">
      <h1>{t('route.about')}</h1>
      
      <div className="about-content">
        <div className="about-avatar">
          <img src="./avatar.jpg" alt="avatar" />
        </div>
        
        <div className="about-info">
          <h2 className="about-nickname-zh">洛斯里克金牌码农</h2>
          <h3 className="about-nickname-en">Lothric Golden Coder</h3>
          <p className="about-bio">全职 AI 应用创业者</p>
          <p className="about-email">
            <a href="mailto:chenmutime@outlook.com">chenmutime@outlook.com</a>
          </p>
        </div>
      </div>

      <div className="about-version-section">
        <div className="version-info">
          <span className="version-label">版本:</span>
          <span className="version-number">{version || '...'}</span>
        </div>
        
        <div className="update-section">
          <p className="update-status">{getUpdateStatusText()}</p>
          {renderUpdateButton()}
        </div>
      </div>
    </section>
  )
}
