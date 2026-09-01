'use client'

import { useState, type FormEvent } from 'react'
import { Button, Input } from '@intelligent-mate/ui'
import { Modal } from './Modal'
import { Textarea } from './Textarea'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { createRoom, updateRoom } from '@/lib/queries'
import { parseNumberInput } from '@/lib/format'
import type { Room } from '@/lib/types'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: (room: Room) => void
  projectId: string
  /** omit for create mode */
  room?: Room
}

export function RoomFormModal({ open, onClose, onSaved, projectId, room }: Props) {
  const editing = Boolean(room)
  const [name, setName] = useState(room?.name ?? '')
  const [length, setLength] = useState(room?.wall_length != null ? String(room.wall_length) : '')
  const [width, setWidth] = useState(room?.wall_width != null ? String(room.wall_width) : '')
  const [notes, setNotes] = useState(room?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Give the room a name.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    try {
      const payload = {
        name: name.trim(),
        notes: notes.trim() || null,
        wall_length: parseNumberInput(length),
        wall_width: parseNumberInput(width),
      }
      const saved = editing
        ? await updateRoom(supabase, room!.id, payload)
        : await createRoom(supabase, { project_id: projectId, ...payload })
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the room.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit room' : 'New room'}
      subtitle="Wall measurements are in inches. Doors and windows come with the floor plan."
    >
      <form className="mm-form" onSubmit={onSubmit}>
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Living room"
          required
        />
        <div className="mm-form__row">
          <Input
            label="Wall length (in)"
            value={length}
            onChange={(e) => setLength(e.target.value)}
            inputMode="decimal"
            placeholder="168"
          />
          <Input
            label="Wall width (in)"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            inputMode="decimal"
            placeholder="144"
          />
        </div>
        <Textarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
        />
        {error && <div className="mm-error">{error}</div>}
        <div className="mm-modal__actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {editing ? 'Save' : 'Add room'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
