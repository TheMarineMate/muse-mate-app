'use client'

import { useId } from 'react'

/**
 * The Muse Mate mark — three fanned panels (navy / teal / burnt orange), from
 * design/muse-mate-brand-assets.html's markSVG(). Colours come from the
 * --brand-* tokens (app-tokens.css), so the mark lightens automatically in
 * dark mode. `glow` adds the up-glow for standalone / hero use; leave it off
 * for small UI placements like the nav.
 */
export function Mark({
  glow = false,
  className,
  title = 'The Muse Mate',
}: {
  glow?: boolean
  className?: string
  title?: string
}) {
  const gid = useId()
  return (
    <svg viewBox="0 0 60 60" className={className} role="img" aria-label={title}>
      {glow && (
        <>
          <defs>
            <radialGradient id={gid} cx="65%" cy="30%" r="55%">
              <stop offset="0%" stopColor="var(--brand-glow)" stopOpacity="0.9" />
              <stop offset="100%" stopColor="var(--brand-glow)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="38" cy="24" r="24" fill={`url(#${gid})`} />
        </>
      )}
      <rect
        x="9"
        y="30"
        width="18"
        height="12"
        rx="3"
        fill="var(--brand-navy)"
        transform="rotate(-6 9 30)"
      />
      <rect
        x="16"
        y="21"
        width="24"
        height="16"
        rx="4"
        fill="var(--brand-teal)"
        transform="rotate(4 16 21)"
      />
      <rect
        x="24"
        y="9"
        width="30"
        height="19"
        rx="4"
        fill="var(--brand-orange)"
        transform="rotate(-3 24 9)"
      />
    </svg>
  )
}
