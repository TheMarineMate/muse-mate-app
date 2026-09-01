'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button, Card, ConfirmDialog } from '@intelligent-mate/ui'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { EmptyState } from '@/components/EmptyState'
import { Fab } from '@/components/Fab'
import { StatusBadge } from '@/components/StatusBadge'
import { ItemFormModal } from '@/components/ItemFormModal'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { deleteItem, getMyRole, getRoom, listItemsByRoom } from '@/lib/queries'
import { formatCurrency, formatInches } from '@/lib/format'
import type { Item, MemberRole, Room } from '@/lib/types'

export default function RoomDetailPage() {
  const params = useParams<{ projectId: string; roomId: string }>()
  const { projectId, roomId } = params

  const [room, setRoom] = useState<Room | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [role, setRole] = useState<MemberRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)
  const [deleting, setDeleting] = useState<Item | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      try {
        const supabase = getSupabaseBrowserClient()
        const { data: auth } = await supabase.auth.getUser()
        const [roomRow, itemRows, myRole] = await Promise.all([
          getRoom(supabase, roomId),
          listItemsByRoom(supabase, roomId),
          auth.user ? getMyRole(supabase, projectId, auth.user.id) : Promise.resolve(null),
        ])
        setRoom(roomRow)
        setItems(itemRows)
        setRole(myRole)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the room.')
      } finally {
        setLoading(false)
      }
    },
    [projectId, roomId]
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await deleteItem(getSupabaseBrowserClient(), deleting.id)
      setDeleting(null)
      await refresh({ silent: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the item.')
    } finally {
      setDeleteBusy(false)
    }
  }

  if (loading && !room) return <FullPageSpinner />

  if (!room) {
    return (
      <div className="mm-stack">
        <Link href={`/projects/${projectId}`} className="mm-backlink">
          ← Back to project
        </Link>
        <Card padding="lg">
          <EmptyState title="Room not found" body="It may have been deleted." />
        </Card>
      </div>
    )
  }

  const canEdit = role === 'owner' || role === 'editor'
  const dims =
    room.wall_length != null && room.wall_width != null
      ? `${formatInches(room.wall_length)} × ${formatInches(room.wall_width)}`
      : null

  return (
    <div className="mm-stack">
      <Link href={`/projects/${projectId}`} className="mm-backlink">
        ← Back to project
      </Link>

      <div className="mm-row-between">
        <div>
          <h1 className="mm-page-title">{room.name}</h1>
          {dims && <div className="mm-muted">{dims}</div>}
        </div>
      </div>

      {room.notes && (
        <Card padding="md">
          <p className="mm-note">{room.notes}</p>
        </Card>
      )}

      {error && <div className="mm-error">{error}</div>}

      <div className="mm-section">
        <div className="mm-section__head">
          <span className="mm-section__title">Items</span>
          {canEdit && items.length > 0 && (
            <button type="button" className="mm-textbtn" onClick={() => setAdding(true)}>
              Add item
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <Card padding="lg">
            <EmptyState
              title="No items yet"
              body={
                canEdit
                  ? 'List what this room needs. Mark priority, then track each item from needed to received.'
                  : 'Nothing has been added to this room yet.'
              }
              action={canEdit ? <Button onClick={() => setAdding(true)}>Add an item</Button> : undefined}
            />
          </Card>
        ) : (
          <Card padding="md">
            {items.map((item) => (
              <div className="mm-itemrow" key={item.id}>
                <div className="mm-itemrow__main">
                  <div className="mm-itemrow__name">{item.name}</div>
                  <div className="mm-itemrow__sub">
                    <StatusBadge status={item.status} />
                    <span>{item.priority === 'must-have' ? 'Must-have' : 'Nice-to-have'}</span>
                    {item.price_estimate != null && (
                      <span>{formatCurrency(item.price_estimate)}</span>
                    )}
                    {item.link && (
                      <a
                        className="mm-inlinelink"
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Link
                      </a>
                    )}
                  </div>
                  {item.note && <div className="mm-cardmeta">{item.note}</div>}
                </div>
                {canEdit && (
                  <div className="mm-itemrow__actions">
                    <button
                      type="button"
                      className="mm-textbtn"
                      onClick={() => setEditing(item)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="mm-textbtn mm-textbtn--danger"
                      onClick={() => setDeleting(item)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </Card>
        )}
      </div>

      {canEdit && <Fab label="Add item" onClick={() => setAdding(true)} />}

      {adding && (
        <ItemFormModal
          open
          roomId={room.id}
          onClose={() => setAdding(false)}
          onSaved={() => void refresh({ silent: true })}
        />
      )}
      {editing && (
        <ItemFormModal
          open
          roomId={room.id}
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void refresh({ silent: true })}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete item"
        message={deleting ? `Remove "${deleting.name}" from ${room.name}?` : ''}
        confirmLabel="Delete"
        destructive
        loading={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
