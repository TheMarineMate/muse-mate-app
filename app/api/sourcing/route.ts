import type Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getAnthropicClient, isAnthropicConfigured, ANTHROPIC_MODEL } from '@/lib/anthropic'
import {
  composeSourcingNote,
  validateAlternatives,
  validateListing,
  type SourcingApiResponse,
} from '@/lib/sourcing'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_CONTINUATIONS = 5

const SUBMIT_TOOL = {
  name: 'submit_sourcing',
  description:
    'Report the sourcing result. Call this exactly once, after you have finished researching with web_search.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['outcome', 'match', 'listing', 'alternatives'],
    properties: {
      outcome: {
        type: 'string',
        enum: ['sourced', 'no_match'],
        description:
          'Use "sourced" only if the primary listing has a real price and a real, direct product URL. Otherwise "no_match".',
      },
      match: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'item_id', 'item_name'],
        properties: {
          kind: { type: 'string', enum: ['existing', 'new'] },
          item_id: {
            type: 'string',
            description:
              'The id of the existing room item this maps to. Empty string if kind is "new".',
          },
          item_name: {
            type: 'string',
            description: 'A short name for the item. Used as-is when kind is "new".',
          },
        },
      },
      listing: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'retailer', 'price_usd', 'url', 'width_in', 'depth_in', 'height_in'],
        properties: {
          title: { type: 'string' },
          retailer: { type: 'string' },
          price_usd: { type: 'number', description: '0 if you have no real price.' },
          url: { type: 'string', description: 'Direct product page URL. Empty string if none.' },
          width_in: {
            type: 'number',
            description: 'Inches, only if the listing states it. Use 0 otherwise. Never estimate.',
          },
          depth_in: { type: 'number', description: 'Inches, from the listing only. 0 otherwise.' },
          height_in: { type: 'number', description: 'Inches, from the listing only. 0 otherwise.' },
        },
      },
      alternatives: {
        type: 'array',
        description: 'Up to 3 other real listings.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'retailer', 'price_usd', 'url'],
          properties: {
            title: { type: 'string' },
            retailer: { type: 'string' },
            price_usd: { type: 'number' },
            url: { type: 'string' },
          },
        },
      },
    },
  },
}

const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 5 }

function systemPrompt(
  roomName: string,
  dims: string | null,
  items: { id: string; name: string; status: string }[]
): string {
  const itemLines =
    items.length > 0
      ? items.map((i) => `- ${i.id} — ${i.name} (${i.status})`).join('\n')
      : '- none yet'
  return [
    'You are a purchasing assistant for one room in a home-design project. Your only job is to find real, currently-purchasable listings for furniture and decor the user describes, then report them as structured data.',
    '',
    `Room: "${roomName}"${dims ? ` (${dims})` : ''}`,
    "Items already on this room's list (id — name (status)):",
    itemLines,
    '',
    'Rules:',
    '- Use web_search to find 2 to 4 listings that are for sale right now, each with a specific product-page URL and a real USD price. Prefer major retailers and the maker\'s own store.',
    '- Choose the single best match as the primary listing; the rest are alternatives (at most 3).',
    '- Report outcome "sourced" ONLY if the primary listing has a real price and a real product URL. If you cannot find one, report outcome "no_match" — that is a valid answer, not a failure. Do not invent prices or links.',
    '- Give width, depth, and height in inches for the primary listing ONLY if the listing states them. Use 0 for any dimension the listing does not give. Never estimate dimensions.',
    '- If the request clearly matches one of the existing items above, set match.kind = "existing" and match.item_id to that id. Otherwise set match.kind = "new", match.item_id = "", and match.item_name to a short name.',
    '- Do not comment on the user\'s taste, style, or design choices. Do not editorialize. Only find and report listings.',
    '- When you have finished researching, call submit_sourcing exactly once.',
  ].join('\n')
}

type Match = { kind?: string; item_id?: string; item_name?: string }
type SubmittedResult = {
  outcome?: string
  match?: Match
  listing?: unknown
  alternatives?: unknown
}

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
      { outcome: 'error', message: "Sourcing isn't set up on this deployment yet.", code: 'not_configured' },
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

  // --- Agentic loop: web_search (server tool) then submit_sourcing --------
  const client = getAnthropicClient()
  const tools = [WEB_SEARCH_TOOL, SUBMIT_TOOL] as unknown as Anthropic.Messages.ToolUnion[]
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: query }]

  let submitted: SubmittedResult | null = null

  try {
    for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
      const response = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 8192,
        system: systemPrompt(room.name, dims, items),
        messages,
        tools,
      })

      if (response.stop_reason === 'pause_turn') {
        // Server-tool loop hit its iteration cap; resend to resume (no extra
        // user message — the API detects the trailing server_tool_use block).
        messages.push({
          role: 'assistant',
          content: response.content as unknown as Anthropic.ContentBlockParam[],
        })
        continue
      }

      const toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_sourcing'
      )
      if (toolUse) {
        submitted = toolUse.input as SubmittedResult
      }
      break
    }
  } catch (err) {
    console.error('[sourcing] anthropic error', err)
    return NextResponse.json(
      { outcome: 'error', message: 'The sourcing assistant is unavailable right now.' },
      { status: 502 }
    )
  }

  if (!submitted) {
    return NextResponse.json({
      outcome: 'no_match',
      message: `No solid listing found yet for "${query}". Add a detail like material, a size range, or a retailer, and try again.`,
      query,
    })
  }

  // --- Rail: only a verified listing produces a "sourced" outcome --------
  const chosen = submitted.outcome === 'sourced' ? validateListing(submitted.listing) : null
  if (!chosen) {
    return NextResponse.json({
      outcome: 'no_match',
      message: `No solid listing found yet for "${query}". Add a detail like material, a size range, or a retailer, and try again.`,
      query,
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
