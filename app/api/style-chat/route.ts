import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getAnthropicClient, isAnthropicConfigured, ANTHROPIC_MODEL } from '@/lib/anthropic'
import { runStyleTurn } from '@/lib/style-engine'
import {
  buildConfirmedProfile,
  describeConfirmation,
  type StyleChatApiResponse,
  type StyleChatMessage,
} from '@/lib/style'
import type { PaletteEntry } from '@/lib/types'

export const runtime = 'nodejs'
// Reference-search turns (web_search + web_fetch) can run long; the engine's own
// 90s abort keeps a turn under this ceiling. Needs a Vercel plan allowing >60s.
export const maxDuration = 120

const MAX_MESSAGES = 30
const MAX_CONTENT = 4000

const errJson = (message: string, status: number, code?: string) =>
  NextResponse.json<StyleChatApiResponse>({ kind: 'error', text: message, ...(code ? { code } : {}) }, { status })

function parseMessages(raw: unknown): StyleChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null
  const out: StyleChatMessage[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null
    const { role, content } = m as { role?: unknown; content?: unknown }
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null
    const text = content.trim().slice(0, MAX_CONTENT)
    if (!text) return null
    out.push({ role, content: text })
  }
  if (out[0].role !== 'user') return null
  return out
}

export async function POST(req: Request): Promise<NextResponse<StyleChatApiResponse>> {
  let body: { projectId?: unknown; messages?: unknown }
  try {
    body = await req.json()
  } catch {
    return errJson('Bad request.', 400)
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId : ''
  const messages = parseMessages(body.messages)
  if (!projectId || !messages) {
    return errJson('Say a little about the space to get started.', 400)
  }

  // Auth and role gate first — an unauthenticated or view-only caller never
  // learns anything about config state.
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return errJson('Sign in first.', 401)

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, address, vibe_notes, style_summary, palette, prefers_unique, deal_sensitive')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return errJson('Project not found.', 404)

  const { data: canEdit } = await supabase.rpc('is_project_member', {
    p_project_id: projectId,
    p_min_role: 'editor',
  })
  if (!canEdit) return errJson("You don't have edit access to this project.", 403)

  if (!isAnthropicConfigured()) {
    return errJson("The style assistant isn't set up on this deployment yet.", 503, 'not_configured')
  }

  let turn
  try {
    turn = await runStyleTurn({
      client: getAnthropicClient(),
      model: ANTHROPIC_MODEL,
      ctx: {
        projectName: project.name,
        address: project.address ?? null,
        vibeNotes: project.vibe_notes ?? null,
        currentSummary: project.style_summary ?? null,
        currentPalette: (project.palette ?? []) as PaletteEntry[],
        prefersUnique: project.prefers_unique ?? null,
        dealSensitive: project.deal_sensitive ?? null,
      },
      messages,
    })
  } catch (err) {
    console.error('[style-chat] anthropic error', err)
    return errJson('The style assistant is unavailable right now.', 502)
  }

  if (turn.kind === 'timeout') {
    return NextResponse.json<StyleChatApiResponse>({
      kind: 'message',
      text: 'That took a while on my end. Where were we — want to keep going?',
    })
  }
  if (turn.kind === 'message') {
    return NextResponse.json<StyleChatApiResponse>({ kind: 'message', text: turn.text })
  }

  // turn.kind === 'confirm' — run the rails before any write.
  const profile = buildConfirmedProfile(turn.input)
  if (!profile) {
    return NextResponse.json<StyleChatApiResponse>({
      kind: 'message',
      text: "I don't have enough pinned down to save yet. Let's keep talking through it.",
    })
  }

  const patch: Record<string, unknown> = {
    style_summary: profile.style_summary,
    style_confirmed_at: new Date().toISOString(),
  }
  // Don't let a missing preference wipe an existing one.
  if (profile.prefers_unique !== null) patch.prefers_unique = profile.prefers_unique
  if (profile.deal_sensitive !== null) patch.deal_sensitive = profile.deal_sensitive
  // Only overwrite the palette when the profile actually proposes one.
  if (profile.palette.length > 0) patch.palette = profile.palette

  const { error: updErr } = await supabase.from('projects').update(patch).eq('id', projectId)
  if (updErr) {
    console.error('[style-chat] project update failed', updErr)
    return errJson('Could not save the style profile.', 500)
  }

  // References are additive (spec 9.1) — insert only URLs not already on file.
  if (profile.references.length > 0) {
    const { data: existingRows } = await supabase
      .from('style_references')
      .select('url')
      .eq('project_id', projectId)
    const existing = new Set((existingRows ?? []).map((r: { url: string | null }) => r.url))
    const fresh = profile.references
      .filter((ref) => !existing.has(ref.url))
      .map((ref) => ({
        project_id: projectId,
        kind: ref.kind,
        url: ref.url,
        caption: ref.caption,
      }))
    if (fresh.length > 0) {
      const { error: refErr } = await supabase.from('style_references').insert(fresh)
      if (refErr) console.error('[style-chat] style_references insert failed', refErr)
    }
  }

  return NextResponse.json<StyleChatApiResponse>({
    kind: 'confirmed',
    text: describeConfirmation(profile),
    profile,
  })
}
