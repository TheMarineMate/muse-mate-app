'use client'

import { useState, type FormEvent } from 'react'
import { Button, Input } from '@intelligent-mate/ui'
import { Modal } from './Modal'
import { Textarea } from './Textarea'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { createProject, updateProject } from '@/lib/queries'
import { parseNumberInput } from '@/lib/format'
import type { Project } from '@/lib/types'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: (project: Project) => void
  /** omit for create mode */
  project?: Project
}

export function ProjectFormModal({ open, onClose, onSaved, project }: Props) {
  const editing = Boolean(project)
  const [name, setName] = useState(project?.name ?? '')
  const [address, setAddress] = useState(project?.address ?? '')
  const [vibe, setVibe] = useState(project?.vibe_notes ?? '')
  const [budget, setBudget] = useState(
    project?.budget_target != null ? String(project.budget_target) : ''
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Give the project a name.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    try {
      const saved = editing
        ? await updateProject(supabase, project!.id, {
            name: name.trim(),
            address: address.trim() || null,
            vibe_notes: vibe.trim() || null,
            budget_target: parseNumberInput(budget),
          })
        : await createProject(supabase, {
            name: name.trim(),
            address: address.trim() || null,
            budget_target: parseNumberInput(budget),
          })
      onSaved(saved)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the project.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit project' : 'New project'}
      subtitle={editing ? undefined : 'You can add rooms and a palette once it exists.'}
    >
      <form className="mm-form" onSubmit={onSubmit}>
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="The Riverhouse"
          required
        />
        <Input
          label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Optional"
        />
        <Input
          label="Budget target"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          inputMode="decimal"
          placeholder="Optional, e.g. 25000"
        />
        {editing && (
          <Textarea
            label="Vibe notes"
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            placeholder="Direction, references, what the space should feel like"
          />
        )}
        {error && <div className="mm-error">{error}</div>}
        <div className="mm-modal__actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {editing ? 'Save' : 'Create project'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
