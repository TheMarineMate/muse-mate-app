'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, Card } from '@intelligent-mate/ui'
import { Textarea } from './Textarea'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  createUploadedStyleReference,
  deleteStyleReference,
  uploadStyleImage,
} from '@/lib/queries'
import { downscaleToJpeg } from '@/lib/image-client'
import {
  MAX_ATTACHMENTS_PER_TURN,
  MAX_UPLOAD_BYTES,
  storageKeyForUpload,
  UPLOAD_IMAGE_MIME,
  type ConfirmedStyleProfile,
  type StyleChatApiResponse,
  type StyleChatMessage,
} from '@/lib/style'

const WAIT_MESSAGES = [
  'Thinking…',
  'Looking for real references…',
  'Reading a few pages…',
  'Still going…',
]

// A photo the current (unsent) turn has attached. It's already uploaded and
// persisted as a style_references row (spec 9.4) — `refId` lets us undo that if
// the user removes it before sending.
type Pending = { key: string; refId: string; previewUrl: string }

// Ephemeral (spec 9.4): the transcript lives only in this component's state and
// is re-sent each turn. Only the confirmed profile + style_references persist.
type Entry =
  | { role: 'user'; text: string; images: string[] }
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
  onChanged,
}: {
  projectId: string
  hasProfile: boolean
  onChanged: () => void
}) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [waitStep, setWaitStep] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!busy) {
      setWaitStep(0)
      return
    }
    const id = setInterval(() => setWaitStep((s) => s + 1), 15000)
    return () => clearInterval(id)
  }, [busy])

  // Release object URLs for any still-pending previews on unmount.
  useEffect(() => {
    return () => {
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function scrollToEnd() {
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    })
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-picking the same file
    if (files.length === 0 || busy) return

    const room = MAX_ATTACHMENTS_PER_TURN - pending.length
    if (room <= 0) {
      setAttachError(`Up to ${MAX_ATTACHMENTS_PER_TURN} photos per message.`)
      return
    }

    setUploading(true)
    setAttachError(null)
    const supabase = getSupabaseBrowserClient()
    const added: Pending[] = []
    try {
      for (const file of files.slice(0, room)) {
        if (!UPLOAD_IMAGE_MIME.includes(file.type as (typeof UPLOAD_IMAGE_MIME)[number])) {
          setAttachError('Images only (JPEG, PNG, WebP, GIF).')
          continue
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          setAttachError('That image is too large.')
          continue
        }
        const blob = await downscaleToJpeg(file)
        const key = storageKeyForUpload(projectId, 'image/jpeg')
        await uploadStyleImage(supabase, key, blob)
        const ref = await createUploadedStyleReference(supabase, { projectId, storagePath: key })
        added.push({ key, refId: ref.id, previewUrl: URL.createObjectURL(blob) })
      }
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
    }
    if (added.length > 0) {
      setPending((prev) => [...prev, ...added])
      onChanged() // the gallery on the dashboard should show them now
    }
  }

  async function removePending(p: Pending) {
    setPending((prev) => prev.filter((x) => x.key !== p.key))
    URL.revokeObjectURL(p.previewUrl)
    try {
      await deleteStyleReference(getSupabaseBrowserClient(), {
        id: p.refId,
        kind: 'uploaded_image',
        storage_path: p.key,
      })
      onChanged()
    } catch {
      // Best effort — a stray reference can be removed from the gallery.
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if ((!text && pending.length === 0) || busy || uploading) return

    const attachments = pending.map((p) => p.key)
    const previews = pending.map((p) => p.previewUrl)
    const nextEntries: Entry[] = [...entries, { role: 'user', text, images: previews }]
    setEntries(nextEntries)
    setInput('')
    setPending([])
    setBusy(true)
    scrollToEnd()

    const messages: StyleChatMessage[] = nextEntries.map((entry, i) => {
      if (entry.role === 'assistant') return { role: 'assistant', content: entry.result.text }
      const isLast = i === nextEntries.length - 1
      return {
        role: 'user',
        content: entry.text,
        ...(isLast && attachments.length > 0 ? { attachments } : {}),
      }
    })

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
    if (result.kind === 'confirmed') onChanged()
  }

  const attachFull = pending.length >= MAX_ATTACHMENTS_PER_TURN

  return (
    <Card padding="md">
      <p className="mm-muted" style={{ marginBottom: 'var(--space-3)' }}>
        {hasProfile
          ? "Pick up where you left off — add texture, adjust the palette, note what to avoid. It builds on the profile, it doesn't restart it."
          : "Talk through the mood, what the space is for, what's already there and loved, and what to steer clear of. Attach photos if it's easier to show than say. The chat itself isn't saved — only the profile you confirm."}
      </p>

      {entries.length > 0 && (
        <div className="mm-sourcing__log" ref={logRef}>
          {entries.map((entry, i) =>
            entry.role === 'user' ? (
              <div key={i} className="mm-sourcing__msg mm-sourcing__msg--user">
                {entry.images.length > 0 && (
                  <div className="mm-style__attachrow">
                    {entry.images.map((src, j) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={j} className="mm-style__attachthumb" src={src} alt="attachment" />
                    ))}
                  </div>
                )}
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

        {pending.length > 0 && (
          <div className="mm-style__attachrow">
            {pending.map((p) => (
              <span key={p.key} className="mm-style__attach">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="mm-style__attachthumb" src={p.previewUrl} alt="attachment preview" />
                <button
                  type="button"
                  className="mm-style__attachx"
                  aria-label="Remove photo"
                  onClick={() => void removePending(p)}
                  disabled={busy}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {attachError && <div className="mm-error">{attachError}</div>}

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => void onFiles(e)}
        />

        <div className="mm-form__row">
          <Button
            type="button"
            variant="secondary"
            onClick={() => fileRef.current?.click()}
            loading={uploading}
            disabled={busy || attachFull}
          >
            {attachFull ? 'Photo limit reached' : 'Add photo'}
          </Button>
          <Button type="submit" loading={busy} disabled={uploading}>
            Send
          </Button>
        </div>
      </form>
    </Card>
  )
}
