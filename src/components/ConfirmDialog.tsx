interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  onConfirm(): void
  onCancel(): void
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null

  return (
    <div className="confirm-dialog-overlay" role="presentation" onClick={props.onCancel}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-badge" aria-hidden="true">
          !
        </div>
        <h3 id="confirm-dialog-title">{props.title}</h3>
        <p>{props.description}</p>
        <div className="confirm-dialog-actions">
          <button className="btn" type="button" onClick={props.onCancel}>
            {props.cancelLabel}
          </button>
          <button className="btn primary" type="button" onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
