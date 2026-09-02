// Live end-to-end exercise of the sourcing engine (real Anthropic + web
// search + web fetch). Mirrors the route's non-HTTP path across a multi-turn
// conversation: each arg after <roomId> is one user turn, run in sequence.
//
//   npm run sourcing:live -- <roomId> "vague opener" "narrower reply" "yes search"
//
// Requires ANTHROPIC_API_KEY + Supabase vars in .env.local. Spends real money.

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { runSourcingTurn } from '../lib/sourcing-engine.ts'
import {
  composeSourcingNote,
  looksLikeSearchOrCategoryPage,
  validateAlternatives,
  validateListing,
  type ConversationMessage,
} from '../lib/sourcing.ts'

// Mirrors validateListing()'s gates so we can see WHICH one rejects a listing.
function diagnose(label: string, raw: unknown) {
  const r = (raw ?? {}) as Record<string, unknown>
  const title = typeof r.title === 'string' ? r.title.trim() : ''
  const urlStr = typeof r.url === 'string' ? r.url.trim() : ''
  const price = Number(r.price_usd ?? r.price)
  const gates = {
    title_ok: Boolean(title),
    url_is_http: /^https?:\/\/[^\s]+$/i.test(urlStr),
    url_not_search_page: urlStr ? !looksLikeSearchOrCategoryPage(urlStr) : false,
    price_ok: Number.isFinite(price) && price > 0,
  }
  console.log(
    `    ${label}: ${validateListing(raw) !== null ? 'PASS' : 'REJECT'}  url=${JSON.stringify(urlStr)} price_usd=${JSON.stringify(r.price_usd)}`
  )
  console.log(`      gates: ${JSON.stringify(gates)}`)
}

const roomId = process.argv[2]
const turns = process.argv.slice(3)
if (!roomId || turns.length === 0) {
  console.error('usage: npm run sourcing:live -- <roomId> "<turn1>" ["<turn2>" ...]')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)
const { error: signInErr } = await supabase.auth.signInWithPassword({
  email: 'dev-owner@musemate.test',
  password: 'muse-dev-owner-1',
})
if (signInErr) throw signInErr

const { data: room, error: roomErr } = await supabase
  .from('rooms')
  .select('id, name, wall_length, wall_width')
  .eq('id', roomId)
  .single()
if (roomErr || !room) throw roomErr ?? new Error('room not found')

const dims =
  room.wall_length != null && room.wall_width != null
    ? `${Number(room.wall_length)}in x ${Number(room.wall_width)}in`
    : null

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
const history: ConversationMessage[] = []

console.log(`room: ${room.name}\n`)

for (const userTurn of turns) {
  history.push({ role: 'user', content: userTurn })
  console.log(`\n>>> user: ${userTurn}`)

  // Re-load items each turn (a prior turn may have written one).
  const { data: itemRows } = await supabase
    .from('items')
    .select('id, name, status')
    .eq('room_id', roomId)
  const items = itemRows ?? []
  const itemIds = new Set(items.map((i) => i.id))

  const t0 = Date.now()
  const turn = await runSourcingTurn({ client, model, roomName: room.name, dims, items, messages: history })
  const secs = Math.round((Date.now() - t0) / 1000)

  if (turn.kind === 'timeout') {
    console.log(`<<< [${secs}s] TIMEOUT -> no_match`)
    history.push({ role: 'assistant', content: 'That search took too long.' })
    continue
  }
  if (turn.kind === 'message') {
    console.log(`<<< [${secs}s] MESSAGE:\n${turn.text}`)
    history.push({ role: 'assistant', content: turn.text })
    continue
  }

  // submit
  const submitted = turn.submitted
  console.log(`<<< [${secs}s] SUBMIT  model outcome=${JSON.stringify(submitted.outcome)}`)
  console.log('    validation breakdown:')
  diagnose('primary', submitted.listing)
  ;(Array.isArray(submitted.alternatives) ? submitted.alternatives : []).forEach((a, i) =>
    diagnose(`alt[${i}]`, a)
  )

  const chosen = submitted.outcome === 'sourced' ? validateListing(submitted.listing) : null
  if (!chosen) {
    console.log('    -> no_match (nothing passed the rail check)')
    history.push({ role: 'assistant', content: "I couldn't confirm a real listing, so I didn't log anything." })
    continue
  }

  const alternatives = validateAlternatives(submitted.alternatives)
  const dimPatch: Record<string, number> = {}
  if (chosen.width_in != null) dimPatch.width = chosen.width_in
  if (chosen.depth_in != null) dimPatch.depth = chosen.depth_in
  if (chosen.height_in != null) dimPatch.height = chosen.height_in
  const sourcedFields = {
    price_estimate: chosen.price,
    link: chosen.url,
    note: composeSourcingNote(chosen, alternatives),
    status: 'sourced' as const,
    sourced_at: new Date().toISOString(),
    sourced_via: 'assistant' as const,
    ...dimPatch,
  }
  const match = submitted.match ?? {}
  const existingId =
    match.kind === 'existing' && match.item_id && itemIds.has(match.item_id) ? match.item_id : null

  let saved
  if (existingId) {
    const { data, error } = await supabase
      .from('items')
      .update(sourcedFields)
      .eq('id', existingId)
      .select('id, name, status, price_estimate, link, sourced_via, width, depth, height, note')
      .single()
    if (error) throw error
    saved = { mode: 'updated existing', ...data }
  } else {
    const name = (match.item_name?.trim() || chosen.title).slice(0, 120)
    const { data, error } = await supabase
      .from('items')
      .insert({ room_id: roomId, name, priority: 'nice-to-have', ...sourcedFields })
      .select('id, name, status, price_estimate, link, sourced_via, width, depth, height, note')
      .single()
    if (error) throw error
    saved = { mode: 'created new', ...data }
  }
  console.log('    -> SOURCED. DB row:', JSON.stringify(saved, null, 2))
  history.push({
    role: 'assistant',
    content: `Logged ${chosen.title} from ${chosen.retailer} at $${Math.round(chosen.price)}.`,
  })
}
