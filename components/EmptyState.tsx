import type { ReactNode } from 'react'

// Section 13 — every empty state tells the user exactly what to do next.
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="mm-empty">
      <div className="mm-empty__title">{title}</div>
      <p className="mm-empty__body">{body}</p>
      {action}
    </div>
  )
}
