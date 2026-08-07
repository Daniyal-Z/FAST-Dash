import { useEffect, useRef } from 'react'

/**
 * A modal confirmation, replacing window.confirm.
 *
 * Beyond looking like the rest of the app, this gets a few things the native
 * dialog cannot: the destructive action can be named ("Remove sheet" rather
 * than "OK"), it can show a busy state while the work runs instead of freezing
 * the page, and it can carry real markup for context.
 *
 * Focus lands on Cancel rather than the destructive button, so a stray Enter
 * dismisses instead of destroying.
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null)
  const cardRef = useRef(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onCancel?.()
        return
      }
      // Keep tabbing inside the dialog while it is open.
      if (e.key !== 'Tab' || !cardRef.current) return
      const focusable = cardRef.current.querySelectorAll(
        'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, busy, onCancel])

  if (!open) return null

  return (
    <div
      className="modal"
      onClick={() => !busy && onCancel?.()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        ref={cardRef}
        className="fd-confirm"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'drop .22s ease' }}
      >
        <div className={'fd-confirm-glyph' + (destructive ? ' danger' : '')} aria-hidden="true">
          {destructive ? '⚠' : '?'}
        </div>

        <h2 id="confirm-title" className="fd-confirm-title">{title}</h2>
        <div className="fd-confirm-body">{children}</div>

        <div className="fd-confirm-actions">
          <button ref={cancelRef} className="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={destructive ? 'fd-danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
