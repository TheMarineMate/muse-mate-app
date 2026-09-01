'use client'

import { useState, type FormEvent } from 'react'
import { Button, Input } from '@intelligent-mate/ui'
import { Modal } from './Modal'
import { Textarea } from './Textarea'
import { SelectField } from './SelectField'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { createItem, statusPatchFor, updateItem, type ItemPatch } from '@/lib/queries'
import { parseNumberInput } from '@/lib/format'
import type { Item, ItemPriority, ItemStatus } from '@/lib/types'

const PRIORITY_OPTIONS = [
  { value: 'must-have', label: 'Must-have' },
  { value: 'nice-to-have', label: 'Nice-to-have' },
]

const STATUS_OPTIONS = [
  { value: 'needed', label: 'Needed' },
  { value: 'sourced', label: 'Sourced' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'received', label: 'Received' },
]

type Props = {
  open: boolean
  onClose: () => void
  onSaved: (item: Item) => void
  roomId: string
  /** omit for create mode */
  item?: Item
}

export function ItemFormModal({ open, onClose, onSaved, roomId, item }: Props) {
  const editing = Boolean(item)
  const [name, setName] = useState(item?.name ?? '')
  const [priority, setPriority] = useState<ItemPriority>(item?.priority ?? 'nice-to-have')
  const [status, setStatus] = useState<ItemStatus>(item?.status ?? 'needed')
  const [price, setPrice] = useState(item?.price_estimate != null ? String(item.price_estimate) : '')
  const [link, setLink] = useState(item?.link ?? '')
  const [note, setNote] = useState(item?.note ?? '')
  const [width, setWidth] = useState(item?.width != null ? String(item.width) : '')
  const [depth, setDepth] = useState(item?.depth != null ? String(item.depth) : '')
  const [height, setHeight] = useState(item?.height != null ? String(item.height) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Give the item a name.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    try {
      const base = {
        name: name.trim(),
        priority,
        price_estimate: parseNumberInput(price),
        link: link.trim() || null,
        note: note.trim() || null,
        width: parseNumberInput(width),
        depth: parseNumberInput(depth),
        height: parseNumberInput(height),
      }

      if (!editing) {
        const created = await createItem(supabase, { room_id: roomId, ...base })
        onSaved(created)
      } else {
        let patch: ItemPatch = { ...base }
        if (status !== item!.status) {
          patch = { ...patch, ...statusPatchFor(status, item!.status) }
        }
        const updated = await updateItem(supabase, item!.id, patch)
        onSaved(updated)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the item.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit item' : 'New item'}
      subtitle={
        editing
          ? undefined
          : 'New items start as "needed". Move them forward as you source and order.'
      }
    >
      <form className="mm-form" onSubmit={onSubmit}>
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sofa"
          required
        />
        <div className="mm-form__row">
          <SelectField
            label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as ItemPriority)}
            options={PRIORITY_OPTIONS}
          />
          {editing && (
            <SelectField
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ItemStatus)}
              options={STATUS_OPTIONS}
            />
          )}
        </div>
        <div className="mm-form__row">
          <Input
            label="Price estimate"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="Optional"
          />
          <Input
            label="Link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <Textarea
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional"
        />
        <div className="mm-form__row">
          <Input
            label="Width (in)"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            inputMode="decimal"
            placeholder="—"
          />
          <Input
            label="Depth (in)"
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
            inputMode="decimal"
            placeholder="—"
          />
          <Input
            label="Height (in)"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            inputMode="decimal"
            placeholder="—"
          />
        </div>
        {error && <div className="mm-error">{error}</div>}
        <div className="mm-modal__actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {editing ? 'Save' : 'Add item'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
