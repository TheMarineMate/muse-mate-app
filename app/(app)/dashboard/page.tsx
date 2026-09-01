'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button, Card } from '@intelligent-mate/ui'
import { FullPageSpinner } from '@/components/FullPageSpinner'
import { EmptyState } from '@/components/EmptyState'
import { Fab } from '@/components/Fab'
import { ProjectFormModal } from '@/components/ProjectFormModal'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { listMyProjects } from '@/lib/queries'
import { formatCurrency } from '@/lib/format'
import type { Project } from '@/lib/types'

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const rows = await listMyProjects(getSupabaseBrowserClient())
      setProjects(rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your projects.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Section 26 — full-page spinner only on the true first load.
  if (loading && !projects) return <FullPageSpinner />

  return (
    <div className="mm-stack">
      <div className="mm-row-between">
        <h1 className="mm-page-title">Your projects</h1>
        {projects && projects.length > 0 && (
          <Button onClick={() => setCreating(true)}>New project</Button>
        )}
      </div>

      {error && <div className="mm-error">{error}</div>}

      {projects && projects.length === 0 && (
        <Card padding="lg">
          <EmptyState
            title="Start your first project"
            body="A project is one space you're designing — its rooms, items, palette, and budget."
            action={<Button onClick={() => setCreating(true)}>Create a project</Button>}
          />
        </Card>
      )}

      {projects && projects.length > 0 && (
        <div className="mm-list">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="mm-linkcard">
              <Card padding="md">
                <div className="mm-cardhead">
                  <div>
                    <div className="mm-cardtitle">{p.name}</div>
                    {p.address && <div className="mm-cardmeta">{p.address}</div>}
                  </div>
                  <span className="mm-muted">
                    {p.budget_target != null ? formatCurrency(p.budget_target) : 'No budget set'}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Fab label="New project" onClick={() => setCreating(true)} />

      {creating && (
        <ProjectFormModal
          open
          onClose={() => setCreating(false)}
          onSaved={() => void refresh({ silent: true })}
        />
      )}
    </div>
  )
}
