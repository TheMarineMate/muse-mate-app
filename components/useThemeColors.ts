'use client'

import { useEffect, useState } from 'react'
import { useTheme } from './ThemeProvider'

// Konva paints to <canvas>, where CSS custom properties don't apply. Resolve the
// tokens the floor plan needs to concrete strings, and re-resolve when the theme
// flips. Values still come from the token system (Section 19) — this only reads
// them out.
const TOKENS = [
  '--accent-product',
  '--text-primary',
  '--text-muted',
  '--border-color',
  '--bg-secondary',
  '--info-text',
] as const

export type ThemeColors = Record<(typeof TOKENS)[number], string>

// Only used if getComputedStyle can't resolve a token (e.g. first paint). Keep
// in step with app-tokens.css — brand accent, brand teal for --info-text.
const FALLBACK: ThemeColors = {
  '--accent-product': '#b85e32',
  '--text-primary': '#0f1f3d',
  '--text-muted': '#8a94a6',
  '--border-color': '#dde1ec',
  '--bg-secondary': '#f5f6fa',
  '--info-text': '#186b5b',
}

export function useThemeColors(): ThemeColors {
  const { theme } = useTheme()
  const [colors, setColors] = useState<ThemeColors>(FALLBACK)

  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    const next = { ...FALLBACK }
    for (const token of TOKENS) {
      const value = cs.getPropertyValue(token).trim()
      if (value) next[token] = value
    }
    setColors(next)
  }, [theme])

  return colors
}
