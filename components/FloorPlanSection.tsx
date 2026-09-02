'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Button, Card } from '@intelligent-mate/ui'
import { EmptyState } from './EmptyState'
import { OpeningsEditor } from './OpeningsEditor'
import type { Box } from './FloorPlanCanvas'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { createPlacement, deletePlacement, updatePlacement } from '@/lib/queries'
import type { Item, Placement, Room } from '@/lib/types'

// Canvas is client-only (Konva touches the DOM canvas API).
const FloorPlanCanvas = dynamic(
  () => import('./FloorPlanCanvas').then((m) => m.FloorPlanCanvas),
  { ssr: false, loading: () => <p className="mm-muted">Loading plan…</p> }
)

export function FloorPlanSection({
  room,
  items,
  placements,
  canEdit,
  onEditRoom,
  onRoomChange,
  onPlacementsChange,
}: {
  room: Room
  items: Item[]
  placements: Placement[]
  canEdit: boolean
  onEditRoom: () => void
  onRoomChange: (room: Room) => void
  onPlacementsChange: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const hasMeasurements = room.wall_length != null && room.wall_width != null

  const sizedItems = useMemo(
    () => items.filter((i) => i.width != null && i.depth != null),
    [items]
  )
  const placementByItem = useMemo(() => {
    const m = new Map<string, Placement>()
    for (const p of placements) m.set(p.item_id, p)
    return m
  }, [placements])

  const boxes: Box[] = useMemo(
    () =>
      sizedItems
        .filter((i) => placementByItem.has(i.id))
        .map((i) => {
          const p = placementByItem.get(i.id)!
          return {
            placementId: p.id,
            itemId: i.id,
            name: i.name,
            widthIn: Number(i.width),
            depthIn: Number(i.depth),
            x: Number(p.x),
            y: Number(p.y),
            rotation: Number(p.rotation),
          }
        }),
    [sizedItems, placementByItem]
  )

  const unplaced = sizedItems.filter((i) => !placementByItem.has(i.id))
  const selectedBox = boxes.find((b) => b.placementId === selectedId) ?? null

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onPlacementsChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the floor plan.')
    } finally {
      setBusy(false)
    }
  }

  const place = (item: Item) =>
    run(() =>
      createPlacement(getSupabaseBrowserClient(), {
        item_id: item.id,
        room_id: room.id,
        x: 0,
        y: 0,
      })
    )

  const move = (placementId: string, x: number, y: number) =>
    run(() => updatePlacement(getSupabaseBrowserClient(), placementId, { x, y }))

  const rotate = () => {
    if (!selectedBox) return
    void run(() =>
      updatePlacement(getSupabaseBrowserClient(), selectedBox.placementId, {
        rotation: (selectedBox.rotation + 90) % 360,
      })
    )
  }

  const removeFromPlan = () => {
    if (!selectedBox) return
    const id = selectedBox.placementId
    setSelectedId(null)
    void run(() => deletePlacement(getSupabaseBrowserClient(), id))
  }

  return (
    <details className="mm-accordion">
      <summary className="mm-accordion__summary">
        <span className="mm-section__title">Floor plan</span>
        <span className="mm-accordion__hint mm-muted">
          {hasMeasurements ? 'tap to open' : 'needs measurements'}
        </span>
        <span className="mm-accordion__chev" aria-hidden>
          ⌄
        </span>
      </summary>
      <div className="mm-accordion__body">
      {!hasMeasurements ? (
        <Card padding="lg">
          <EmptyState
            title="Add wall measurements"
            body={
              canEdit
                ? 'Set this room’s wall length and width (in inches) to draw the plan to scale.'
                : 'This room has no measurements yet, so there’s no plan to show.'
            }
            action={
              canEdit ? (
                <Button onClick={onEditRoom}>Add measurements</Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card padding="md">
          <FloorPlanCanvas
            roomWidthIn={Number(room.wall_length)}
            roomDepthIn={Number(room.wall_width)}
            doors={room.doors ?? []}
            windows={room.windows ?? []}
            boxes={boxes}
            canEdit={canEdit}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={move}
          />

          <div className="mm-legend">
            <span className="mm-legend__item">
              <span className="mm-legend__swatch mm-legend__swatch--door" /> Door
            </span>
            <span className="mm-legend__item">
              <span className="mm-legend__swatch mm-legend__swatch--window" /> Window
            </span>
            <span className="mm-muted">Room drawn to scale · measurements in inches</span>
          </div>

          {canEdit && selectedBox && (
            <div className="mm-floorplan__controls">
              <span className="mm-muted">{selectedBox.name}</span>
              <Button type="button" variant="secondary" onClick={rotate} disabled={busy}>
                Rotate 90°
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={removeFromPlan}
                disabled={busy}
              >
                Remove from plan
              </Button>
            </div>
          )}

          {error && <div className="mm-error">{error}</div>}

          {canEdit && (
            <div className="mm-section" style={{ marginTop: 'var(--space-4)' }}>
              <span className="mm-section__title">Not on the plan yet</span>
              {sizedItems.length === 0 ? (
                <p className="mm-muted">
                  Add a width and depth to an item to place it on the plan.
                </p>
              ) : unplaced.length === 0 ? (
                <p className="mm-muted">Everything with dimensions is placed.</p>
              ) : (
                <div className="mm-tray">
                  {unplaced.map((item) => (
                    <span className="mm-tray__chip" key={item.id}>
                      {item.name}
                      <button
                        type="button"
                        className="mm-textbtn"
                        onClick={() => place(item)}
                        disabled={busy}
                      >
                        Place
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {hasMeasurements && canEdit && (
        <Card padding="md" style={{ marginTop: 'var(--space-3)' }}>
          <OpeningsEditor room={room} onSaved={onRoomChange} />
        </Card>
      )}
      </div>
    </details>
  )
}
