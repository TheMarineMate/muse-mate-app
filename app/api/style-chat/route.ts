import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getAnthropicClient, isAnthropicConfigured, ANTHROPIC_MODEL } from '@/lib/anthropic'
import { runStyleTurn, type StyleTurnMessage } from '@/lib/style-engine'
import {
  buildConfirmedProfile,
  describeConfirmation,
  isValidStoragePath,
  mediaTypeFromPath,
  MAX_ATTACHMENTS_PER_TURN,
  MAX_ATTACHMENTS_TOTAL,
  MAX_IMAGE_B64_BYTES,
  type StyleChatApiResponse,
} from '@/lib/style'
import type { PaletteEntry } from '@/lib/types'

export const runtime = 'nodejs'
// Reference-search turns (web_search + web_fetch) can run long; the engine's own
// 90s abort keeps a turn under this ceiling. Needs a Vercel plan allowing >60s.
export const maxDuration = 120

const STORAGE_BUCKET = 'style-references'
const MAX_MESSAGES = 30
const MAX_CONTENT = 4000

const errJson = (message: string, status: number, code?: string) =>
  NextResponse.json<StyleChatApiResponse>({ kind: 'error', text: message, ...(code ? { code } : {}) }, { status })

/** Parsed wire message — attachments are still raw Storage keys here; they're
 *  validated and resolved to image bytes only after the role gate passes. */
type ParsedMessage = { role: 'user' | 'assistant'; content: string; attachments: string[] }

function parseMessages(raw: unknown): ParsedMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null
  const out: ParsedMessage[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null
    const { role, content, attachments } = m as {
      role?: unknown
      content?: unknown
      attachments?: unknown
    }
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null
    const text = content.trim().slice(0, MAX_CONTENT)
    let keys: string[] = []
    if (attachments !== undefined) {
      if (!Array.isArray(attachments) || attachments.some((a) => typeof a !== 'string')) return null
      keys = attachments as string[]
      if (role !== 'user') return null
      if (keys.length > MAX_ATTACHMENTS_PER_TURN) return null
    }
    // A turn must carry text or at least one image.
    if (!text && keys.length === 0) return null
    out.push({ role, content: text, attachments: keys })
  }
  if (out[0].role !== 'user') return null
  if (out.reduce((n, m) => n + m.attachments.length, 0) > MAX_ATTACHMENTS_TOTAL) return null
  return out
}

/**
 * Resolve each message's Storage keys to inline base64 image data for the model
 * (Phase 6c). Paths are validated against the project id first; the bucket RLS
 * is the real boundary, this is belt-and-braces. A key that fails validation or
 * download is skipped, not fatal — the conversation still runs on the text.
 */
async function resolveAttachments(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  projectId: string,
  parsed: ParsedMessage[]
): Promise<StyleTurnMessage[]> {
  const out: StyleTurnMessage[] = []
  for (const m of parsed) {
    if (m.role === 'assistant' || m.attachments.length === 0) {
      out.push({ role: m.role, content: m.content })
      continue
    }
    const images: NonNullable<Extract<StyleTurnMessage, { role: 'user' }>['images']> = []
    for (const key of m.attachments) {
      if (!isValidStoragePath(key, projectId)) continue
      const media_type = mediaTypeFromPath(key)
      if (!media_type) continue
      const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(key)
      if (error || !data) {
        console.error('[style-chat] attachment download failed', key, error?.message)
        continue
      }
      const bytes = Buffer.from(await data.arrayBuffer())
      const b64 = bytes.toString('base64')
      if (b64.length > MAX_IMAGE_B64_BYTES) {
        console.error('[style-chat] attachment too large after encode, skipping', key)
        continue
      }
      images.push({ media_type, data: b64 })
    }
    out.push({ role: 'user', content: m.content, images })
  }
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
  const parsed = parseMessages(body.messages)
  if (!projectId || !parsed) {
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

  const messages = await resolveAttachments(supabase, projectId, parsed)

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

  // Web references are additive (spec 9.1) — insert only URLs not already on
  // file. Uploaded images are persisted client-side at upload time, not here.
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
