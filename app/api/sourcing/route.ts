import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getAnthropicClient, isAnthropicConfigured, ANTHROPIC_MODEL } from '@/lib/anthropic'
import { runSourcing } from '@/lib/sourcing-engine'
import {
  composeSourcingNote,
  validateAlternatives,
  validateListing,
  type SourcingApiResponse,
} from '@/lib/sourcing'

export const runtime = 'nodejs'
// Web search + reading pages can take a while. Needs a Vercel plan that allows
// >60s functions (Pro+); on Hobby it caps at 60s and long searches will 504.
export const maxDuration = 120

const noMatch = (query: string): SourcingApiResponse => ({
  outcome: 'no_match',
  message: `No solid listing found yet for "${query}". Add a detail like material, a size range, or a retailer, and try again.`,
  query,
})

export async function POST(req: Request): Promise<NextResponse<SourcingApiResponse>> {
  let body: { roomId?: unknown; query?: unknown; targetItemId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ outcome: 'error', message: 'Bad request.' }, { status: 400 })
  }

  const roomId = typeof body.roomId === 'string' ? body.roomId : ''
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 500) : ''
  const targetItemId = typeof body.targetItemId === 'string' ? body.targetItemId : null
  if (!roomId || !query) {
    return NextResponse.json(
      { outcome: 'error', message: 'Describe the item you want to source.' },
      { status: 400 }
    )
  }

  // Auth and role gate first — an unauthenticated or view-only caller never
  // learns anything about config state.
  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ outcome: 'error', message: 'Sign in first.' }, { status: 401 })
  }

  const { data: room } = await supabase
    .from('rooms')
    .select('id, name, project_id, wall_length, wall_width')
    .eq('id', roomId)
    .maybeSingle()
  if (!room) {
    return NextResponse.json({ outcome: 'error', message: 'Room not found.' }, { status: 404 })
  }

  const { data: canEdit } = await supabase.rpc('is_project_member', {
    p_project_id: room.project_id,
    p_min_role: 'editor',
  })
  if (!canEdit) {
    return NextResponse.json(
      { outcome: 'error', message: "You don't have edit access to this project." },
      { status: 403 }
    )
  }

  if (!isAnthropicConfigured()) {
    return NextResponse.json(
      {
        outcome: 'error',
        message: "Sourcing isn't set up on this deployment yet.",
        code: 'not_configured',
      },
      { status: 503 }
    )
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

  let engine
  try {
    engine = await runSourcing({
      client: getAnthropicClient(),
      model: ANTHROPIC_MODEL,
      roomName: room.name,
      dims,
      items,
      query,
    })
  } catch (err) {
    console.error('[sourcing] anthropic error', err)
    return NextResponse.json(
      { outcome: 'error', message: 'The sourcing assistant is unavailable right now.' },
      { status: 502 }
    )
  }

  if (engine.kind === 'timeout') {
    return NextResponse.json({
      outcome: 'no_match',
      message:
        'That search took too long — try a more specific query (a material, a size, or a retailer).',
      query,
    })
  }
  if (engine.kind === 'no_result') {
    return NextResponse.json(noMatch(query))
  }
  const submitted = engine.submitted

  // --- Rail: only a verified listing produces a "sourced" outcome --------
  const chosen = submitted.outcome === 'sourced' ? validateListing(submitted.listing) : null
  if (!chosen) {
    return NextResponse.json(noMatch(query))
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
      return NextResponse.json(
        { outcome: 'error', message: 'Could not update the item.' },
        { status: 500 }
      )
    }
    saved = data
  } else {
    isNewItem = true
    const name = (match.item_name?.trim() || query).slice(0, 120)
    const { data, error } = await supabase
      .from('items')
      .insert({ room_id: roomId, name, priority: 'nice-to-have', ...sourcedFields })
      .select('id, name')
      .single()
    if (error || !data) {
      console.error('[sourcing] insert failed', error)
      return NextResponse.json(
        { outcome: 'error', message: 'Could not save the sourced item.' },
        { status: 500 }
      )
    }
    saved = data
  }

  return NextResponse.json({
    outcome: 'sourced',
    message: `Logged "${chosen.title}" to ${saved.name}.`,
    itemId: saved.id,
    itemName: saved.name,
    isNewItem,
    chosen,
    alternatives,
  })
}
