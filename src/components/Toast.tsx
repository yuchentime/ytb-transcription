import { useEffect, useState } from 'react'

interface ToastProps {
  message: string
  visible: boolean
  onClose: () => void
  duration?: number
  type?: 'success' | 'error'
}

export function Toast(props: ToastProps) {
  const { message, visible, onClose, duration = 3000, type = 'success' } = props
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    if (!visible) return

    setIsClosing(false)
    const timer = setTimeout(() => {
      setIsClosing(true)
    }, duration - 200)

    const closeTimer = setTimeout(() => {
      onClose()
    }, duration)

    return () => {
      clearTimeout(timer)
      clearTimeout(closeTimer)
    }
  }, [visible, duration, onClose])

  if (!visible) return null

  return (
    <div className={`toast ${type} ${isClosing ? 'closing' : ''}`}>
      <span className="toast-message">{message}</span>
    </div>
  )
}
