'use client'

import { useState } from 'react'
import { Button, ColorPicker, Input } from '@intelligent-mate/ui'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { setProjectPalette } from '@/lib/queries'
import type { PaletteEntry } from '@/lib/types'

// Muse's palette is layered secondary tones, not one saturated accent
// (platform doc Section 2). Editable inline by editor+.
export function PaletteEditor({
  projectId,
  palette,
  canEdit,
  onChange,
}: {
  projectId: string
  palette: PaletteEntry[]
  canEdit: boolean
  onChange: (next: PaletteEntry[]) => void
}) {
  const [adding, setAdding] = useState(false)
  // Starter value only — a brand tone (burnt orange). The user picks the real
  // colour; nothing here feeds the theme system.
  const [hex, setHex] = useState('#D97A4E')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function persist(next: PaletteEntry[]) {
    setBusy(true)
    setError(null)
    try {
      await setProjectPalette(getSupabaseBrowserClient(), projectId, next)
      onChange(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the palette.')
    } finally {
      setBusy(false)
    }
  }

  async function addColor() {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      setError('Pick a valid hex color.')
      return
    }
    await persist([...palette, { hex: hex.toUpperCase(), label: label.trim() || hex.toUpperCase() }])
    setAdding(false)
    setLabel('')
  }

  function removeColor(index: number) {
    void persist(palette.filter((_, i) => i !== index))
  }

  return (
    <div className="mm-section">
      <div className="mm-section__head">
        <span className="mm-section__title">Palette</span>
        {canEdit && !adding && (
          <button type="button" className="mm-textbtn" onClick={() => setAdding(true)} disabled={busy}>
            Add color
          </button>
        )}
      </div>

      {palette.length === 0 && !adding && (
        <p className="mm-muted">No colors yet.</p>
      )}

      {palette.length > 0 && (
        <div className="mm-palette">
          {palette.map((entry, i) => (
            <span className="mm-swatch" key={`${entry.hex}-${i}`}>
              <span className="mm-swatch__dot" style={{ backgroundColor: entry.hex }} />
              {entry.label}
              {canEdit && (
                <button
                  type="button"
                  className="mm-swatch__remove"
                  aria-label={`Remove ${entry.label}`}
                  onClick={() => removeColor(i)}
                  disabled={busy}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {adding && (
        <div className="mm-form">
          <ColorPicker value={hex} onChange={setHex} label="Color" />
          <Input
            label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Warm putty"
          />
          {error && <div className="mm-error">{error}</div>}
          <div className="mm-modal__actions">
            <Button type="button" variant="secondary" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={addColor} loading={busy}>
              Add
            </Button>
          </div>
        </div>
      )}

      {error && !adding && <div className="mm-error">{error}</div>}
    </div>
  )
}
