import Link from 'next/link'
import { Card } from '@intelligent-mate/ui'
import { formatInches } from '@/lib/format'
import type { Item, ItemStatus, Room } from '@/lib/types'

const ORDER: ItemStatus[] = ['needed', 'sourced', 'ordered', 'received']
const LABEL: Record<ItemStatus, string> = {
  needed: 'needed',
  sourced: 'sourced',
  ordered: 'ordered',
  received: 'received',
}

export function RoomCard({
  projectId,
  room,
  items,
}: {
  projectId: string
  room: Room
  items: Item[]
}) {
  const counts = ORDER.map((s) => ({ s, n: items.filter((i) => i.status === s).length })).filter(
    (c) => c.n > 0
  )
  const dims =
    room.wall_length != null && room.wall_width != null
      ? `${formatInches(room.wall_length)} × ${formatInches(room.wall_width)}`
      : 'No measurements yet'

  return (
    <Link href={`/projects/${projectId}/rooms/${room.id}`} className="mm-linkcard">
      <Card padding="md">
        <div className="mm-cardhead">
          <div>
            <div className="mm-cardtitle">{room.name}</div>
            <div className="mm-cardmeta">{dims}</div>
          </div>
          <span className="mm-muted">{items.length} item{items.length === 1 ? '' : 's'}</span>
        </div>
        {counts.length > 0 && (
          <div className="mm-cardmeta" style={{ marginTop: 'var(--space-2)' }}>
            {counts.map((c, i) => (
              <span key={c.s}>
                {i > 0 ? ' · ' : ''}
                {c.n} {LABEL[c.s]}
              </span>
            ))}
          </div>
        )}
      </Card>
    </Link>
  )
}
