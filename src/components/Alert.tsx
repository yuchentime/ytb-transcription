interface AlertProps {
  message: string
  visible: boolean
  onClose: () => void
  type?: 'success' | 'error' | 'warning'
}

export function Alert(props: AlertProps) {
  const { message, visible, onClose, type = 'error' } = props

  if (!visible) return null

  return (
    <div className="alert-overlay" role="presentation" onClick={onClose}>
      <div
        className={`alert ${type}`}
        role="alert"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="alert-message">{message}</span>
        <button
          type="button"
          className="alert-close-btn"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>
    </div>
  )
}
