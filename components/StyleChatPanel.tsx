'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Card } from '@intelligent-mate/ui'
import { Textarea } from './Textarea'
import type { ConfirmedStyleProfile, StyleChatApiResponse, StyleChatMessage } from '@/lib/style'

const WAIT_MESSAGES = [
  'Thinking…',
  'Looking for real references…',
  'Reading a few pages…',
  'Still going…',
]

// Ephemeral (spec 9.4): the transcript lives only in this component's state and
// is re-sent each turn. Only the confirmed profile + style_references persist.
type Entry =
  | { role: 'user'; text: string }
  | { role: 'assistant'; result: StyleChatApiResponse }

function ProfileCard({ profile }: { profile: ConfirmedStyleProfile }) {
  return (
    <div className="mm-style__profile">
      {profile.style_summary.split('\n').map((line, i) => (
        <p key={i} className="mm-style__line">
          {line}
        </p>
      ))}
      {profile.palette.length > 0 && (
        <div className="mm-palette" style={{ marginTop: 'var(--space-2)' }}>
          {profile.palette.map((entry, i) => (
            <span className="mm-swatch" key={`${entry.hex}-${i}`}>
              <span className="mm-swatch__dot" style={{ backgroundColor: entry.hex }} />
              {entry.label}
            </span>
          ))}
        </div>
      )}
      {(profile.prefers_unique !== null || profile.deal_sensitive !== null) && (
        <p className="mm-style__line mm-muted">
          {profile.prefers_unique !== null &&
            `Shopping: ${profile.prefers_unique ? 'leans unique / handmade' : 'open to mass-market'}`}
          {profile.prefers_unique !== null && profile.deal_sensitive !== null && ' · '}
          {profile.deal_sensitive !== null &&
            (profile.deal_sensitive ? 'check for current sales' : 'fit over price')}
        </p>
      )}
      {profile.references.length > 0 && (
        <ul className="mm-style__refs">
          {profile.references.map((ref) => (
            <li key={ref.url}>
              <a className="mm-inlinelink" href={ref.url} target="_blank" rel="noopener noreferrer">
                {ref.caption || ref.url} ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AssistantEntry({ result }: { result: StyleChatApiResponse }) {
  if (result.kind === 'confirmed') {
    return (
      <div className="mm-sourcing__msg mm-sourcing__msg--assistant">
        <div>{result.text}</div>
        <ProfileCard profile={result.profile} />
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

export function StyleChatPanel({
  projectId,
  hasProfile,
  onConfirmed,
}: {
  projectId: string
  hasProfile: boolean
  onConfirmed: () => void
}) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [waitStep, setWaitStep] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!busy) {
      setWaitStep(0)
      return
    }
    const id = setInterval(() => setWaitStep((s) => s + 1), 15000)
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

    const messages: StyleChatMessage[] = nextEntries.map((entry) =>
      entry.role === 'user'
        ? { role: 'user', content: entry.text }
        : { role: 'assistant', content: entry.result.text }
    )

    let result: StyleChatApiResponse
    try {
      const res = await fetch('/api/style-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, messages }),
      })
      result = (await res.json()) as StyleChatApiResponse
    } catch {
      result = { kind: 'error', text: 'Network error. Try again.' }
    }

    setEntries((prev) => [...prev, { role: 'assistant', result }])
    setBusy(false)
    scrollToEnd()
    if (result.kind === 'confirmed') onConfirmed()
  }

  return (
    <Card padding="md">
      <p className="mm-muted" style={{ marginBottom: 'var(--space-3)' }}>
        {hasProfile
          ? "Pick up where you left off — add texture, adjust the palette, note what to avoid. It builds on the profile, it doesn't restart it."
          : "Talk through the mood, what the space is for, what's already there and loved, and what to steer clear of. The chat itself isn't saved — only the profile you confirm."}
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
          label={entries.length === 0 ? 'Start anywhere' : 'Reply'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="It's a rental that needs to photograph bright and feel calm — warm, a little coastal, nothing too on-theme"
          disabled={busy}
        />
        <div>
          <Button type="submit" loading={busy}>
            Send
          </Button>
        </div>
      </form>
    </Card>
  )
}
