'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Card } from '@intelligent-mate/ui'
import { Textarea } from './Textarea'
import { SelectField } from './SelectField'
import { formatCurrency } from '@/lib/format'
import type { Item } from '@/lib/types'
import type { ConversationMessage, Listing, SourcingApiResponse } from '@/lib/sourcing'

const WAIT_MESSAGES = [
  'Thinking…',
  'Searching current listings…',
  'Reading product pages…',
  'Checking prices and availability…',
  'Still going…',
]

// Ephemeral (spec Section 5): the transcript lives only in this component's
// state and is re-sent each turn. Nothing is persisted but the item record.
type Entry =
  | { role: 'user'; text: string }
  | { role: 'assistant'; result: SourcingApiResponse }

function ListingCard({ listing, primary }: { listing: Listing; primary?: boolean }) {
  return (
    <div className={primary ? 'mm-listing mm-listing--primary' : 'mm-listing'}>
      <div className="mm-listing__title">{listing.title}</div>
      <div className="mm-listing__meta">
        {listing.retailer && <span>{listing.retailer}</span>}
        <span>{formatCurrency(listing.price)}</span>
      </div>
      <a className="mm-inlinelink" href={listing.url} target="_blank" rel="noopener noreferrer">
        View listing ↗
      </a>
    </div>
  )
}

function AssistantEntry({ result }: { result: SourcingApiResponse }) {
  if (result.kind === 'sourced') {
    return (
      <div className="mm-sourcing__msg mm-sourcing__msg--assistant">
        <div>{result.text}</div>
        <div className="mm-sourcing__listings">
          <ListingCard listing={result.chosen} primary />
          {result.alternatives.map((a) => (
            <ListingCard key={a.url} listing={a} />
          ))}
        </div>
      </div>
    )
  }
  if (result.kind === 'no_match') {
    return (
      <div className="mm-sourcing__msg mm-sourcing__msg--assistant">
        <div className="mm-sourcing__nomatch">{result.text}</div>
      </div>
    )
  }
  if (result.kind === 'error') {
    return (
      <div className="mm-sourcing__msg mm-sourcing__msg--assistant">
        <div className="mm-error">{result.text}</div>
      </div>
    )
  }
  return <div className="mm-sourcing__msg mm-sourcing__msg--assistant">{result.text}</div>
}

export function SourcingPanel({
  roomId,
  items,
  onSourced,
}: {
  roomId: string
  items: Item[]
  onSourced: () => void
}) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [target, setTarget] = useState('auto')
  const [busy, setBusy] = useState(false)
  const [waitStep, setWaitStep] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!busy) {
      setWaitStep(0)
      return
    }
    const id = setInterval(() => setWaitStep((s) => s + 1), 18000)
    return () => clearInterval(id)
  }, [busy])

  function scrollToEnd() {
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    })
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return

    const nextEntries: Entry[] = [...entries, { role: 'user', text }]
    setEntries(nextEntries)
    setInput('')
    setBusy(true)
    scrollToEnd()

    const messages: ConversationMessage[] = nextEntries.map((entry) =>
      entry.role === 'user'
        ? { role: 'user', content: entry.text }
        : { role: 'assistant', content: entry.result.text }
    )

    let result: SourcingApiResponse
    try {
      const res = await fetch('/api/sourcing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          roomId,
          messages,
          targetItemId: target === 'auto' ? null : target,
        }),
      })
      result = (await res.json()) as SourcingApiResponse
    } catch {
      result = { kind: 'error', text: 'Network error. Try again.' }
    }

    setEntries((prev) => [...prev, { role: 'assistant', result }])
    setBusy(false)
    scrollToEnd()
    if (result.kind === 'sourced') onSourced()
  }

  const targetOptions = [
    { value: 'auto', label: 'Match automatically' },
    ...items.map((i) => ({ value: i.id, label: `Log to: ${i.name}` })),
  ]

  return (
    <div className="mm-section">
      <span className="mm-section__title">Sourcing</span>
      <Card padding="md">
        <p className="mm-muted" style={{ marginBottom: 'var(--space-3)' }}>
          Describe what you&apos;re after — a rough idea is fine. I&apos;ll ask questions
          if I need to, then search real retailers and log what I find. The chat
          itself isn&apos;t saved.
        </p>

        {entries.length > 0 && (
          <div className="mm-sourcing__log" ref={logRef}>
            {entries.map((entry, i) =>
              entry.role === 'user' ? (
                <div key={i} className="mm-sourcing__msg mm-sourcing__msg--user">
                  {entry.text}
                </div>
              ) : (
                <AssistantEntry key={i} result={entry.result} />
              )
            )}
            {busy && (
              <div className="mm-sourcing__msg mm-sourcing__msg--assistant">
                <span className="mm-muted">
                  {WAIT_MESSAGES[Math.min(waitStep, WAIT_MESSAGES.length - 1)]}
                </span>
              </div>
            )}
          </div>
        )}

        <form className="mm-form" onSubmit={onSubmit}>
          <Textarea
            label={entries.length === 0 ? 'What do you have in mind?' : 'Reply'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Something cozy for the reading corner — maybe a small accent chair"
            disabled={busy}
          />
          {items.length > 0 && (
            <SelectField
              label="Where to log anything found"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              options={targetOptions}
              disabled={busy}
            />
          )}
          <div>
            <Button type="submit" loading={busy}>
              Send
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
