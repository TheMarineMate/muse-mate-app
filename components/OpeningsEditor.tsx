'use client'

import { useState } from 'react'
import { Button, Input } from '@intelligent-mate/ui'
import { SelectField } from './SelectField'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { updateRoom } from '@/lib/queries'
import { parseNumberInput } from '@/lib/format'
import { WALL_OPTIONS } from '@/lib/floorplan'
import type { Opening, Room, Wall } from '@/lib/types'

const TYPE_OPTIONS = [
  { value: 'door', label: 'Door' },
  { value: 'window', label: 'Window' },
]

export function OpeningsEditor({
  room,
  onSaved,
}: {
  room: Room
  onSaved: (room: Room) => void
}) {
  const [type, setType] = useState<'door' | 'window'>('door')
  const [wall, setWall] = useState<Wall>('N')
  const [offset, setOffset] = useState('')
  const [width, setWidth] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doors = room.doors ?? []
  const windows = room.windows ?? []

  async function persist(nextDoors: Opening[], nextWindows: Opening[]) {
    setBusy(true)
    setError(null)
    try {
      const saved = await updateRoom(getSupabaseBrowserClient(), room.id, {
        doors: nextDoors,
        windows: nextWindows,
      })
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the opening.')
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    const o = parseNumberInput(offset)
    const w = parseNumberInput(width)
    if (o == null || w == null || o < 0 || w <= 0) {
      setError('Enter an offset and a width in inches.')
      return
    }
    const entry: Opening = { wall, offset: o, width: w }
    if (type === 'door') await persist([...doors, entry], windows)
    else await persist(doors, [...windows, entry])
    setOffset('')
    setWidth('')
  }

  function remove(kind: 'door' | 'window', index: number) {
    if (kind === 'door') void persist(doors.filter((_, i) => i !== index), windows)
    else void persist(doors, windows.filter((_, i) => i !== index))
  }

  const rows: { kind: 'door' | 'window'; index: number; o: Opening }[] = [
    ...doors.map((o, index) => ({ kind: 'door' as const, index, o })),
    ...windows.map((o, index) => ({ kind: 'window' as const, index, o })),
  ]

  return (
    <div className="mm-section">
      <span className="mm-section__title">Doors &amp; windows</span>

      {rows.length === 0 ? (
        <p className="mm-muted">None yet.</p>
      ) : (
        <div className="mm-list">
          {rows.map(({ kind, index, o }) => (
            <div className="mm-itemrow" key={`${kind}-${index}`}>
              <div className="mm-itemrow__sub" style={{ marginTop: 0 }}>
                <span>{kind === 'door' ? 'Door' : 'Window'}</span>
                <span>
                  {o.wall} wall · {o.offset}&quot; in · {o.width}&quot; wide
                </span>
              </div>
              <button
                type="button"
                className="mm-textbtn mm-textbtn--danger"
                onClick={() => remove(kind, index)}
                disabled={busy}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mm-form__row">
        <SelectField
          label="Type"
          value={type}
          onChange={(e) => setType(e.target.value as 'door' | 'window')}
          options={TYPE_OPTIONS}
        />
        <SelectField
          label="Wall"
          value={wall}
          onChange={(e) => setWall(e.target.value as Wall)}
          options={WALL_OPTIONS}
        />
      </div>
      <div className="mm-form__row">
        <Input
          label="Offset (in)"
          value={offset}
          onChange={(e) => setOffset(e.target.value)}
          inputMode="decimal"
          placeholder="from wall start"
        />
        <Input
          label="Width (in)"
          value={width}
          onChange={(e) => setWidth(e.target.value)}
          inputMode="decimal"
          placeholder="32"
        />
      </div>
      {error && <div className="mm-error">{error}</div>}
      <div>
        <Button type="button" variant="secondary" onClick={add} loading={busy}>
          Add opening
        </Button>
      </div>
    </div>
  )
}
