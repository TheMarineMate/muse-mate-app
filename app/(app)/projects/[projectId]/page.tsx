'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button, Card } from '@intelligent-mate/ui'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { EmptyState } from '@/components/EmptyState'
import { Fab } from '@/components/Fab'
import { BudgetRollup } from '@/components/BudgetRollup'
import { RoomCard } from '@/components/RoomCard'
import { PaletteEditor } from '@/components/PaletteEditor'
import { ProjectFormModal } from '@/components/ProjectFormModal'
import { RoomFormModal } from '@/components/RoomFormModal'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { getMyRole, getProject, listItemsByProject, listRooms } from '@/lib/queries'
import type { Item, MemberRole, PaletteEntry, Project, Room } from '@/lib/types'

export default function ProjectDashboardPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId

  const [project, setProject] = useState<Project | null>(null)
  const [role, setRole] = useState<MemberRole | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingProject, setEditingProject] = useState(false)
  const [addingRoom, setAddingRoom] = useState(false)

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      try {
        const supabase = getSupabaseBrowserClient()
        const { data: auth } = await supabase.auth.getUser()
        const [proj, myRole, roomRows, itemRows] = await Promise.all([
          getProject(supabase, projectId),
          auth.user ? getMyRole(supabase, projectId, auth.user.id) : Promise.resolve(null),
          listRooms(supabase, projectId),
          listItemsByProject(supabase, projectId),
        ])
        setProject(proj)
        setRole(myRole)
        setRooms(roomRows)
        setItems(itemRows)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the project.')
      } finally {
        setLoading(false)
      }
    },
    [projectId]
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading && !project) return <FullPageSpinner />

  if (!project) {
    return (
      <div className="mm-stack">
        <Link href="/dashboard" className="mm-backlink">
          ← All projects
        </Link>
        <Card padding="lg">
          <EmptyState
            title="Project not found"
            body="It may have been deleted, or you no longer have access to it."
            action={
              <Link href="/dashboard">
                <Button variant="secondary">Back to projects</Button>
              </Link>
            }
          />
        </Card>
      </div>
    )
  }

  const canEdit = role === 'owner' || role === 'editor'
  const itemsByRoom = (roomId: string) => items.filter((i) => i.room_id === roomId)

  return (
    <div className="mm-stack">
      <Link href="/dashboard" className="mm-backlink">
        ← All projects
      </Link>

      <div className="mm-row-between">
        <div>
          <h1 className="mm-page-title">{project.name}</h1>
          {project.address && <div className="mm-muted">{project.address}</div>}
        </div>
        {canEdit && (
          <Button variant="secondary" onClick={() => setEditingProject(true)}>
            Edit
          </Button>
        )}
      </div>

      {error && <div className="mm-error">{error}</div>}

      <BudgetRollup items={items} budgetTarget={project.budget_target} />

      {project.vibe_notes && (
        <Card padding="lg">
          <div className="mm-section__title">Vibe</div>
          <p className="mm-note" style={{ marginTop: 'var(--space-2)' }}>
            {project.vibe_notes}
          </p>
        </Card>
      )}

      <Card padding="lg">
        <PaletteEditor
          projectId={project.id}
          palette={project.palette as PaletteEntry[]}
          canEdit={canEdit}
          onChange={(next) => setProject({ ...project, palette: next })}
        />
      </Card>

      <div className="mm-section">
        <div className="mm-section__head">
          <span className="mm-section__title">Rooms</span>
          {canEdit && rooms.length > 0 && (
            <button type="button" className="mm-textbtn" onClick={() => setAddingRoom(true)}>
              Add room
            </button>
          )}
        </div>

        {rooms.length === 0 ? (
          <Card padding="lg">
            <EmptyState
              title="No rooms yet"
              body={
                canEdit
                  ? 'Add a room to start a checklist and, later, a to-scale floor plan.'
                  : 'The owner or an editor hasn’t added any rooms yet.'
              }
              action={
                canEdit ? (
                  <Button onClick={() => setAddingRoom(true)}>Add a room</Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <div className="mm-list">
            {rooms.map((room) => (
              <RoomCard
                key={room.id}
                projectId={project.id}
                room={room}
                items={itemsByRoom(room.id)}
              />
            ))}
          </div>
        )}
      </div>

      {canEdit && <Fab label="Add room" onClick={() => setAddingRoom(true)} />}

      {editingProject && (
        <ProjectFormModal
          open
          project={project}
          onClose={() => setEditingProject(false)}
          onSaved={(saved) => setProject(saved)}
        />
      )}
      {addingRoom && (
        <RoomFormModal
          open
          projectId={project.id}
          onClose={() => setAddingRoom(false)}
          onSaved={() => void refresh({ silent: true })}
        />
      )}
    </div>
  )
}
