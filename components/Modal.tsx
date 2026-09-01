'use client'

import { useEffect, type ReactNode } from 'react'

// Generic modal. @intelligent-mate/ui ships only ConfirmDialog, so this fills
// the "form in a dialog" gap — reusing the package's .im-ui-dialog__* classes
// for visual parity. Extraction candidate for the shared package (Section 17).
export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="im-ui-dialog__overlay" onClick={onClose}>
      <div
        className="im-ui-dialog__panel mm-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mm-modal__title">{title}</h2>
        {subtitle && <p className="mm-modal__sub">{subtitle}</p>}
        {children}
      </div>
    </div>
  )
}
