'use client'

import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Card } from '@intelligent-mate/ui'
import { Textarea } from './Textarea'
import { SelectField } from './SelectField'
import { formatCurrency, formatInches } from '@/lib/format'
import type { Item } from '@/lib/types'
import type { ConversationMessage, Listing, SourcingApiResponse } from '@/lib/sourcing'

const WAIT_MESSAGES = [
  'Thinking…',
  'Searching current listings…',
  'Reading product pages…',
  'Checking prices and availability…',
  'Still going…',
]

// A bit above the server route's 120s maxDuration, so a genuinely hung request
// fails with a clear message instead of spinning forever on mobile.
const CLIENT_TIMEOUT_MS = 125_000

async function postSourcing(body: {
  roomId: string
  messages: ConversationMessage[]
  targetItemId: string | null
}): Promise<SourcingApiResponse> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS)
  try {
    const res = await fetch('/api/sourcing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const raw = await res.text()
    let parsed: unknown = null
    try {
      parsed = raw ? JSON.parse(raw) : null
    } catch {
      parsed = null
    }
    if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
      return parsed as SourcingApiResponse
    }
    if (res.status === 504 || res.status === 408 || res.status === 502) {
      return {
        kind: 'no_match',
        text: 'That one ran long and timed out before it finished. Narrow it — a material, a size, or a specific store — and send again.',
      }
    }
    return { kind: 'error', text: 'Something went wrong on that request. Try again.' }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        kind: 'no_match',
        text: "That search is taking longer than it should. Try again, or narrow it down and I'll be quicker.",
      }
    }
    return { kind: 'error', text: "Couldn't reach the server. Check your connection and try again." }
  } finally {
    clearTimeout(timer)
  }
}

// Ephemeral (spec Section 5): the transcript lives only in this component's
// state and is re-sent each turn. Nothing is persisted but the item record.
type Entry =
  | { role: 'user'; text: string }
  | { role: 'assistant'; result: SourcingApiResponse }

/** "View on Wayfair" / "View on article.com" — the retailer if we have it,
 *  otherwise the bare host. */
function retailerLabel(url: string, retailer?: string): string {
  if (retailer && retailer.trim()) return `View on ${retailer.trim()}`
  try {
    return `View on ${new URL(url).hostname.replace(/^www\./, '')}`
  } catch {
    return 'View listing'
  }
}

function LinkPill({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="mm-linkpill" href={href} target="_blank" rel="noopener noreferrer">
      {children} <span aria-hidden>↗</span>
    </a>
  )
}

const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
const BARE_URL = /(https?:\/\/[^\s)\]]+)/g

/** Render assistant prose with any URL — markdown link or bare — as a tappable
 *  "View on <retailer>" pill instead of a raw string. */
function Linkified({ text }: { text: string }) {
  // First pass: markdown links -> pills. Second pass: bare URLs in the rest.
  const nodes: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  MD_LINK.lastIndex = 0
  while ((m = MD_LINK.exec(text))) {
    if (m.index > last) nodes.push(plainWithBareUrls(text.slice(last, m.index), `t${last}`))
    nodes.push(
      <LinkPill key={`md${m.index}`} href={m[2]}>
        {retailerLabel(m[2])}
      </LinkPill>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(plainWithBareUrls(text.slice(last), `t${last}`))
  return <>{nodes}</>
}

function plainWithBareUrls(chunk: string, keyBase: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  BARE_URL.lastIndex = 0
  while ((m = BARE_URL.exec(chunk))) {
    if (m.index > last) parts.push(chunk.slice(last, m.index))
    parts.push(
      <LinkPill key={`${keyBase}u${m.index}`} href={m[1]}>
        {retailerLabel(m[1])}
      </LinkPill>
    )
    last = m.index + m[1].length
  }
  parts.push(chunk.slice(last))
  return (
    <Fragment key={keyBase}>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </Fragment>
  )
}

function dimsLabel(l: Listing): string | null {
  const d = [l.width_in, l.depth_in, l.height_in].filter((n): n is number => n != null && n > 0)
  if (d.length === 0) return null
  return d.map((n) => formatInches(n)).join(' × ')
}

function ListingCard({
  listing,
  primary,
  onLog,
}: {
  listing: Listing
  primary?: boolean
  onLog?: (l: Listing) => void
}) {
  const dims = dimsLabel(listing)
  return (
    <div className={primary ? 'mm-listing mm-listing--primary' : 'mm-listing'}>
      <div className="mm-listing__title">{listing.title}</div>
      <div className="mm-listing__meta">
        {listing.retailer && <span>{listing.retailer}</span>}
        <span>{formatCurrency(listing.price)}</span>
        {dims && <span>{dims}</span>}
      </div>
      <div className="mm-listing__actions">
        <LinkPill href={listing.url}>{retailerLabel(listing.url, listing.retailer)}</LinkPill>
        {onLog && (
          <button type="button" className="mm-listing__log" onClick={() => onLog(listing)}>
            Log this
          </button>
        )}
      </div>
    </div>
  )
}

function AssistantEntry({
  result,
  onLog,
}: {
  result: SourcingApiResponse
  onLog: (l: Listing) => void
}) {
  if (result.kind === 'sourced') {
    return (
      <div className="mm-sourcing__msg mm-sourcing__msg--assistant">
        <div>
          <Linkified text={result.text} />
        </div>
        <div className="mm-sourcing__listings">
          <ListingCard listing={result.chosen} primary />
          {result.alternatives.map((a) => (
            <ListingCard key={a.url} listing={a} />
          ))}
        </div>
      </div>
    )
  }
  if (result.kind === 'options') {
    return (
      <div className="mm-sourcing__msg mm-sourcing__msg--assistant">
        <div>
          <Linkified text={result.text} />
        </div>
        <div className="mm-sourcing__listings">
          {result.options.map((o, i) => (
            <ListingCard key={o.url} listing={o} primary={i === 0} onLog={onLog} />
          ))}
        </div>
      </div>
    )
  }
  if (result.kind === 'no_match') {
    return (
      <div className="mm-sourcing__msg mm-sourcing__msg--assistant">
        <div className="mm-sourcing__nomatch">
          <Linkified text={result.text} />
        </div>
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
  return (
    <div className="mm-sourcing__msg mm-sourcing__msg--assistant">
      <Linkified text={result.text} />
    </div>
  )
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

  async function send(text: string) {
    if (!text.trim() || busy) return
    const nextEntries: Entry[] = [...entries, { role: 'user', text: text.trim() }]
    setEntries(nextEntries)
    setInput('')
    setBusy(true)
    scrollToEnd()

    // Don't feed a prior failure notice back to the model as conversation.
    const messages: ConversationMessage[] = nextEntries
      .filter((entry) => !(entry.role === 'assistant' && entry.result.kind === 'error'))
      .map((entry) =>
        entry.role === 'user'
          ? { role: 'user', content: entry.text }
          : { role: 'assistant', content: entry.result.text }
      )

    const result = await postSourcing({
      roomId,
      messages,
      targetItemId: target === 'auto' ? null : target,
    })

    setEntries((prev) => [...prev, { role: 'assistant', result }])
    setBusy(false)
    scrollToEnd()
    if (result.kind === 'sourced') onSourced()
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void send(input)
  }

  const onLog = (l: Listing) =>
    void send(`Log this one: ${l.title}${l.retailer ? ` from ${l.retailer}` : ''} — ${l.url}`)

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
          if I need to, then search real retailers. The chat itself isn&apos;t saved.
        </p>

        {entries.length > 0 && (
          <div className="mm-sourcing__log" ref={logRef}>
            {entries.map((entry, i) =>
              entry.role === 'user' ? (
                <div key={i} className="mm-sourcing__msg mm-sourcing__msg--user">
                  {entry.text}
                </div>
              ) : (
                <AssistantEntry key={i} result={entry.result} onLog={onLog} />
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
