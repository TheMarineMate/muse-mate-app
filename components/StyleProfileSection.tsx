'use client'

import { useState } from 'react'
import { Button, Card } from '@intelligent-mate/ui'
import { EmptyState } from './EmptyState'
import { StyleChatPanel } from './StyleChatPanel'
import { StyleReferenceGallery } from './StyleReferenceGallery'
import type { Project, StyleReference } from '@/lib/types'

// Phase 6 (spec 9.1) — the project dashboard entry point for the style
// conversation. Revisitable and additive: reopening continues the profile, it
// doesn't restart it. Viewers see the saved profile read-only.
export function StyleProfileSection({
  project,
  references,
  canEdit,
  onChanged,
}: {
  project: Project
  references: StyleReference[]
  canEdit: boolean
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const hasProfile = Boolean(project.style_confirmed_at)
  const summaryLines = project.style_summary
    ? project.style_summary.split('\n').filter(Boolean)
    : []

  const toggleLabel = open
    ? 'Hide conversation'
    : hasProfile
      ? 'Continue the conversation'
      : 'Talk through the vibe'

  return (
    <div className="mm-section">
      <div className="mm-section__head">
        <span className="mm-section__title">Style profile</span>
        {canEdit && (
          <button type="button" className="mm-textbtn" onClick={() => setOpen((v) => !v)}>
            {toggleLabel}
          </button>
        )}
      </div>

      {summaryLines.length > 0 ? (
        <Card padding="lg">
          {summaryLines.map((line, i) => (
            <p key={i} className="mm-note" style={i > 0 ? { marginTop: 'var(--space-2)' } : undefined}>
              {line}
            </p>
          ))}
          {project.style_confirmed_at && (
            <p className="mm-muted" style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)' }}>
              Updated {new Date(project.style_confirmed_at).toLocaleDateString()}
            </p>
          )}
          <StyleReferenceGallery references={references} canEdit={canEdit} onChanged={onChanged} />
        </Card>
      ) : references.length > 0 ? (
        <Card padding="lg">
          <StyleReferenceGallery references={references} canEdit={canEdit} onChanged={onChanged} />
        </Card>
      ) : (
        !open && (
          <Card padding="lg">
            <EmptyState
              title="No style profile yet"
              body={
                canEdit
                  ? 'Have a conversation about the vibe — mood, materials, what to avoid, how you like to shop. Every room chat starts from it.'
                  : 'The owner or an editor hasn’t developed the vibe yet.'
              }
              action={
                canEdit ? <Button onClick={() => setOpen(true)}>Talk through the vibe</Button> : undefined
              }
            />
          </Card>
        )
      )}

      {open && canEdit && (
        <StyleChatPanel projectId={project.id} hasProfile={hasProfile} onChanged={onChanged} />
      )}
    </div>
  )
}
