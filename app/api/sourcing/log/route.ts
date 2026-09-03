import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import {
  buildSourcedItemFields,
  validateListing,
  type Listing,
  type PriceConfirmation,
  type SourcingApiResponse,
} from '@/lib/sourcing'

export const runtime = 'nodejs'

// The human-confirmed logging path (spec Section 5 integrity rule). The model's
// submit_sourcing only auto-logs when priceInPage() confirms the price on a
// page it fetched — which almost never happens, because retailer PDPs
// client-render the price. This endpoint is the other half: a project editor
// taps "Log this" on a candidate, gets a confirm step in the UI, and vouches
// for the price themselves. No model call, no priceInPage — a person is the
// verifier here, and price_confirmation records that.

const errJson = (message: string, status: number) =>
  NextResponse.json<SourcingApiResponse>({ kind: 'error', text: message }, { status })

type Body = {
  roomId?: unknown
  listing?: unknown
  targetItemId?: unknown
  itemName?: unknown
  confirmation?: unknown
}

export async function POST(req: Request): Promise<NextResponse<SourcingApiResponse>> {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return errJson('Bad request.', 400)
  }

  const roomId = typeof body.roomId === 'string' ? body.roomId : ''
  const targetItemId = typeof body.targetItemId === 'string' ? body.targetItemId : null
  const itemNameHint = typeof body.itemName === 'string' ? body.itemName.trim().slice(0, 120) : ''
  const requested: PriceConfirmation =
    body.confirmation === 'fetch_verified' ? 'fetch_verified' : 'human_confirmed'

  // Same real-title / real-URL / real-price / not-a-category-page rail as the
  // model path. The only check we skip is priceInPage — the human is standing
  // in for it.
  const chosen: Listing | null = validateListing(body.listing)
  if (!roomId || !chosen) {
    return errJson("That listing didn't have a real price and product link, so nothing was logged.", 400)
  }
  // 'fetch_verified' is only honest when the engine already marked this option
  // verified in the options payload the client is echoing back. Otherwise a
  // person is vouching, so record human_confirmed.
  const confirmation: PriceConfirmation =
    requested === 'fetch_verified' && chosen.priceVerified ? 'fetch_verified' : 'human_confirmed'

  const supabase = await getSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return errJson('Sign in first.', 401)

  const { data: room } = await supabase
    .from('rooms')
    .select('id, project_id')
    .eq('id', roomId)
    .maybeSingle()
  if (!room) return errJson('Room not found.', 404)

  const { data: canEdit } = await supabase.rpc('is_project_member', {
    p_project_id: room.project_id,
    p_min_role: 'editor',
  })
  if (!canEdit) return errJson("You don't have edit access to this project.", 403)

  const { data: itemRows } = await supabase
    .from('items')
    .select('id')
    .eq('room_id', roomId)
  const itemIds = new Set((itemRows ?? []).map((r) => r.id as string))

  const fields = buildSourcedItemFields(chosen, [], confirmation)
  const existingId = targetItemId && itemIds.has(targetItemId) ? targetItemId : null

  let saved: { id: string; name: string } | null = null
  let isNewItem = false

  if (existingId) {
    const { data, error } = await supabase
      .from('items')
      .update(fields)
      .eq('id', existingId)
      .select('id, name')
      .single()
    if (error || !data) {
      console.error('[sourcing/log] update failed', error)
      return errJson('Could not update the item.', 500)
    }
    saved = data
  } else {
    isNewItem = true
    const name = (itemNameHint || chosen.title).slice(0, 120)
    const { data, error } = await supabase
      .from('items')
      .insert({ room_id: roomId, name, priority: 'nice-to-have', ...fields })
      .select('id, name')
      .single()
    if (error || !data) {
      console.error('[sourcing/log] insert failed', error)
      return errJson('Could not save the item.', 500)
    }
    saved = data
  }

  const money = `$${Math.round(chosen.price).toLocaleString('en-US')}`
  const how = confirmation === 'human_confirmed' ? ', confirmed by you' : ''
  const text = `Logged ${chosen.title}${chosen.retailer ? ` from ${chosen.retailer}` : ''} at ${money}${how} to ${saved.name}${isNewItem ? ' (new item)' : ''}.`

  return NextResponse.json<SourcingApiResponse>({
    kind: 'sourced',
    text,
    itemId: saved.id,
    itemName: saved.name,
    isNewItem,
    chosen,
    alternatives: [],
  })
}
