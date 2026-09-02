'use client'

import { useEffect, useState } from 'react'
import { ConfirmDialog } from '@intelligent-mate/ui'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { deleteStyleReference, signedStyleImageUrl } from '@/lib/queries'
import type { StyleReference } from '@/lib/types'

// Phase 6c — the lasting visual record for a project (spec 9.4): uploaded
// photos plus any real web images/links the conversation kept. Uploaded images
// are private, so each needs a short-lived signed URL to display.
export function StyleReferenceGallery({
  references,
  canEdit,
  onChanged,
}: {
  references: StyleReference[]
  canEdit: boolean
  onChanged: () => void
}) {
  const [signed, setSigned] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<StyleReference | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const uploads = references.filter((r) => r.kind === 'uploaded_image' && r.storage_path)
    if (uploads.length === 0) {
      setSigned({})
      return
    }
    const supabase = getSupabaseBrowserClient()
    void Promise.all(
      uploads.map(async (r) => [r.id, await signedStyleImageUrl(supabase, r.storage_path as string)] as const)
    ).then((pairs) => {
      if (cancelled) return
      const next: Record<string, string> = {}
      for (const [id, url] of pairs) if (url) next[id] = url
      setSigned(next)
    })
    return () => {
      cancelled = true
    }
  }, [references])

  if (references.length === 0) return null

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    setError(null)
    try {
      await deleteStyleReference(getSupabaseBrowserClient(), deleting)
      setDeleting(null)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that reference.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mm-style__gallery">
      {error && <div className="mm-error">{error}</div>}
      <div className="mm-style__grid">
        {references.map((ref) => {
          const imgSrc =
            ref.kind === 'uploaded_image' ? signed[ref.id] : ref.kind === 'web_image' ? ref.url : null
          return (
            <figure className="mm-style__card" key={ref.id}>
              {imgSrc ? (
                <a href={imgSrc} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="mm-style__img" src={imgSrc} alt={ref.caption || 'Style reference'} />
                </a>
              ) : ref.kind === 'web_link' && ref.url ? (
                <a className="mm-inlinelink mm-style__linkcard" href={ref.url} target="_blank" rel="noopener noreferrer">
                  {ref.caption || ref.url} ↗
                </a>
              ) : (
                <div className="mm-style__imgpending mm-muted">…</div>
              )}
              {ref.caption && imgSrc && <figcaption className="mm-style__cap">{ref.caption}</figcaption>}
              {canEdit && (
                <button
                  type="button"
                  className="mm-style__del"
                  aria-label="Remove reference"
                  onClick={() => setDeleting(ref)}
                >
                  ×
                </button>
              )}
            </figure>
          )
        })}
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove reference"
        message="Take this out of the project's style references?"
        confirmLabel="Remove"
        destructive
        loading={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
