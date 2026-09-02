import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getAnthropicClient, isAnthropicConfigured, ANTHROPIC_MODEL } from '@/lib/anthropic'
import { runSourcingTurn, type SourcingImage, type SourcingStyleContext } from '@/lib/sourcing-engine'
import { computeBudgetRollup, describeBudgetForPrompt, type BudgetItem } from '@/lib/budget'
import { mediaTypeFromPath, MAX_IMAGE_B64_BYTES } from '@/lib/style'
import type { PaletteEntry } from '@/lib/types'
import {
  composeSourcingNote,
  validateAlternatives,
  validateListing,
  type ConversationMessage,
  type SourcingApiResponse,
} from '@/lib/sourcing'

export const runtime = 'nodejs'
// Search turns (web_search + web_fetch) can take a while. Needs a Vercel plan
// that allows >60s functions (Pro+); the engine's own 90s abort keeps a turn
// under this ceiling.
export const maxDuration = 120

const STYLE_BUCKET = 'style-references'
// Cap on reference photos re-sent to the model each sourcing turn — bounds cost
// while still giving the room chat the project's visual vibe.
const STYLE_REF_IMAGE_CAP = 3
const MAX_MESSAGES = 24
const MAX_CONTENT = 2000

const errJson = (message: string, status: number, code?: string) =>
  NextResponse.json<SourcingApiResponse>({ kind: 'error', text: message, ...(code ? { code } : {}) }, { status })

function parseMessages(raw: unknown): ConversationMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null
  const out: ConversationMessage[] = []
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

export async function POST(req: Request): Promise<NextResponse<SourcingApiResponse>> {
  let body: { roomId?: unknown; messages?: unknown; targetItemId?: unknown }
  try {
    body = await req.json()
  } catch {
    return errJson('Bad request.', 400)
  }

  const roomId = typeof body.roomId === 'string' ? body.roomId : ''
  const messages = parseMessages(body.messages)
  const targetItemId = typeof body.targetItemId === 'string' ? body.targetItemId : null
  if (!roomId || !messages) {
    return errJson('Say what you have in mind.', 400)
  }

  // Auth and role gate first — an unauthenticated or view-only caller never
  // learns anything about config state.
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return errJson('Sign in first.', 401)

  const { data: room } = await supabase
    .from('rooms')
    .select('id, name, project_id, wall_length, wall_width')
    .eq('id', roomId)
    .maybeSingle()
  if (!room) return errJson('Room not found.', 404)

  const { data: canEdit } = await supabase.rpc('is_project_member', {
    p_project_id: room.project_id,
    p_min_role: 'editor',
  })
  if (!canEdit) return errJson("You don't have edit access to this project.", 403)

  if (!isAnthropicConfigured()) {
    return errJson("Sourcing isn't set up on this deployment yet.", 503, 'not_configured')
  }

  const { data: itemRows } = await supabase
    .from('items')
    .select('id, name, status')
    .eq('room_id', roomId)
  const items = (itemRows ?? []) as { id: string; name: string; status: string }[]
  const itemIds = new Set(items.map((i) => i.id))

  const dims =
    room.wall_length != null && room.wall_width != null
      ? `${Number(room.wall_length)}in x ${Number(room.wall_width)}in`
      : null

  // Project budget + style context (spec 9.2): a room chat inherits both so the
  // vibe and affordability never need re-explaining. Rollup spans every room.
  const [{ data: projectRow }, { data: budgetItemRows }, { data: refRows }] = await Promise.all([
    supabase
      .from('projects')
      .select('budget_target, style_summary, palette, prefers_unique, deal_sensitive')
      .eq('id', room.project_id)
      .maybeSingle(),
    supabase.from('items').select('price_estimate, status').eq('project_id', room.project_id),
    supabase
      .from('style_references')
      .select('kind, url, caption, storage_path')
      .eq('project_id', room.project_id),
  ])

  const budget = describeBudgetForPrompt(
    computeBudgetRollup(
      (budgetItemRows ?? []) as BudgetItem[],
      projectRow?.budget_target ?? null
    )
  )

  // Split style references: web links stay text, uploaded photos become image
  // blocks on the first user turn (capped).
  const refs = (refRows ?? []) as {
    kind: string
    url: string | null
    caption: string | null
    storage_path: string | null
  }[]
  const webRefs = refs
    .filter((r) => (r.kind === 'web_link' || r.kind === 'web_image') && r.url)
    .map((r) => ({ url: r.url as string, caption: r.caption }))
  const uploadedKeys = refs
    .filter((r) => r.kind === 'uploaded_image' && r.storage_path)
    .map((r) => r.storage_path as string)
    .slice(0, STYLE_REF_IMAGE_CAP)

  const styleImages: SourcingImage[] = []
  for (const key of uploadedKeys) {
    const media_type = mediaTypeFromPath(key)
    if (!media_type) continue
    const { data, error } = await supabase.storage.from(STYLE_BUCKET).download(key)
    if (error || !data) {
      console.error('[sourcing] style image download failed', key, error?.message)
      continue
    }
    const b64 = Buffer.from(await data.arrayBuffer()).toString('base64')
    if (b64.length > MAX_IMAGE_B64_BYTES) continue
    styleImages.push({ media_type, data: b64 })
  }

  const palette = (projectRow?.palette ?? []) as PaletteEntry[]
  const hasStyle =
    Boolean(projectRow?.style_summary) ||
    palette.length > 0 ||
    projectRow?.prefers_unique != null ||
    projectRow?.deal_sensitive != null ||
    webRefs.length > 0 ||
    styleImages.length > 0
  const style: SourcingStyleContext | null = hasStyle
    ? {
        summary: projectRow?.style_summary ?? null,
        palette,
        prefersUnique: projectRow?.prefers_unique ?? null,
        dealSensitive: projectRow?.deal_sensitive ?? null,
        webRefs,
        imageCount: styleImages.length,
      }
    : null

  let turn
  try {
    turn = await runSourcingTurn({
      client: getAnthropicClient(),
      model: ANTHROPIC_MODEL,
      roomName: room.name,
      dims,
      items,
      budget,
      style,
      styleImages,
      messages,
    })
  } catch (err) {
    console.error('[sourcing] anthropic error', err)
    return errJson('The sourcing assistant is unavailable right now.', 502)
  }

  if (turn.kind === 'timeout') {
    return NextResponse.json<SourcingApiResponse>({
      kind: 'no_match',
      text: 'That search took a while and I came up empty. Try narrowing it down — a material, a size, or a specific retailer.',
    })
  }
  if (turn.kind === 'exhausted') {
    return NextResponse.json<SourcingApiResponse>({
      kind: 'no_match',
      text: "I went through this pass without landing solid options. Narrow it a little — a material, a size range, or a specific store — and send again.",
    })
  }
  if (turn.kind === 'message') {
    return NextResponse.json<SourcingApiResponse>({ kind: 'message', text: turn.text })
  }

  // turn.kind === 'submit' — run the hard rail before any write.
  const submitted = turn.submitted
  const chosen = submitted.outcome === 'sourced' ? validateListing(submitted.listing) : null
  if (!chosen) {
    return NextResponse.json<SourcingApiResponse>({
      kind: 'no_match',
      text: "I found a page but couldn't confirm a real price or a direct product link, so I didn't log anything. Want me to try a different retailer?",
    })
  }
  const alternatives = validateAlternatives(submitted.alternatives)
  const note = composeSourcingNote(chosen, alternatives)

  const dimPatch: Record<string, number> = {}
  if (chosen.width_in != null) dimPatch.width = chosen.width_in
  if (chosen.depth_in != null) dimPatch.depth = chosen.depth_in
  if (chosen.height_in != null) dimPatch.height = chosen.height_in

  const sourcedFields = {
    price_estimate: chosen.price,
    link: chosen.url,
    note,
    status: 'sourced' as const,
    sourced_at: new Date().toISOString(),
    sourced_via: 'assistant' as const,
    ...dimPatch,
  }

  // Target: the user's explicit pick wins, then the model's match, else new.
  const match = submitted.match ?? {}
  const existingId =
    targetItemId && itemIds.has(targetItemId)
      ? targetItemId
      : match.kind === 'existing' && match.item_id && itemIds.has(match.item_id)
        ? match.item_id
        : null

  let saved: { id: string; name: string } | null = null
  let isNewItem = false

  if (existingId) {
    const { data, error } = await supabase
      .from('items')
      .update(sourcedFields)
      .eq('id', existingId)
      .select('id, name')
      .single()
    if (error || !data) {
      console.error('[sourcing] update failed', error)
      return errJson('Could not update the item.', 500)
    }
    saved = data
  } else {
    isNewItem = true
    const name = (match.item_name?.trim() || chosen.title).slice(0, 120)
    const { data, error } = await supabase
      .from('items')
      .insert({ room_id: roomId, name, priority: 'nice-to-have', ...sourcedFields })
      .select('id, name')
      .single()
    if (error || !data) {
      console.error('[sourcing] insert failed', error)
      return errJson('Could not save the sourced item.', 500)
    }
    saved = data
  }

  const money = `$${Math.round(chosen.price).toLocaleString('en-US')}`
  const text = `Logged ${chosen.title}${chosen.retailer ? ` from ${chosen.retailer}` : ''} at ${money} to ${saved.name}${isNewItem ? ' (new item)' : ''}.`

  return NextResponse.json<SourcingApiResponse>({
    kind: 'sourced',
    text,
    itemId: saved.id,
    itemName: saved.name,
    isNewItem,
    chosen,
    alternatives,
  })
}
