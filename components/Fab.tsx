'use client'

// Section 13 — mobile floating action button for the primary "add" action.
export function Fab({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="mm-fab" onClick={onClick} aria-label={label}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  )
}
