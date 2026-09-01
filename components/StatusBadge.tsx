import type { ItemStatus } from '@/lib/types'

// status -> semantic token family (Section 19). needed = not-yet-anything
// (neutral), sourced = info, ordered = in-progress caution (warning),
// received = done (success). Priority is intentionally NOT a semantic badge —
// it's plain text weight — so the status tokens keep their platform meaning.
const MAP: Record<ItemStatus, { cls: string; label: string }> = {
  needed: { cls: 'mm-badge--neutral', label: 'Needed' },
  sourced: { cls: 'mm-badge--info', label: 'Sourced' },
  ordered: { cls: 'mm-badge--warning', label: 'Ordered' },
  received: { cls: 'mm-badge--success', label: 'Received' },
}

export function StatusBadge({ status }: { status: ItemStatus }) {
  const { cls, label } = MAP[status]
  return <span className={`mm-badge ${cls}`}>{label}</span>
}
