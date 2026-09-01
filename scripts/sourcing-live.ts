// Live end-to-end exercise of the sourcing engine (real Anthropic + web
// search). Mirrors the route's non-HTTP path: sign in as the dev owner, load
// the room, run the engine, apply the rails, write the item.
//
//   npm run sourcing:live -- <roomId> "<query>"
//
// Requires ANTHROPIC_API_KEY + Supabase vars in .env.local. Spends real money.

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { runSourcing } from '../lib/sourcing-engine.ts'
import {
  composeSourcingNote,
  validateAlternatives,
  validateListing,
} from '../lib/sourcing.ts'

const roomId = process.argv[2]
const query = process.argv[3]
if (!roomId || !query) {
  console.error('usage: npm run sourcing:live -- <roomId> "<query>"')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(url, anon, { auth: { persistSession: false } })
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

const { data: itemRows } = await supabase
  .from('items')
  .select('id, name, status')
  .eq('room_id', roomId)
const items = itemRows ?? []
const itemIds = new Set(items.map((i) => i.id))
const dims =
  room.wall_length != null && room.wall_width != null
    ? `${Number(room.wall_length)}in x ${Number(room.wall_width)}in`
    : null

console.log(`query: ${query}\nroom: ${room.name}\n`)
const t0 = Date.now()

const engine = await runSourcing({
  client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  roomName: room.name,
  dims,
  items,
  query,
})

console.log(`engine returned in ${Math.round((Date.now() - t0) / 1000)}s (kind: ${engine.kind})`)

if (engine.kind === 'timeout') {
  console.log('OUTCOME: no_match (engine timed out after ~90s)')
  process.exit(0)
}
if (engine.kind === 'no_result') {
  console.log('OUTCOME: no_match (model did not call submit_sourcing)')
  process.exit(0)
}
const submitted = engine.submitted
console.log('raw submitted:', JSON.stringify(submitted, null, 2), '\n')

const chosen = submitted.outcome === 'sourced' ? validateListing(submitted.listing) : null
if (!chosen) {
  console.log('OUTCOME: no_match (no listing passed the rail check)')
  console.log('  model outcome was:', submitted.outcome)
  process.exit(0)
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
  saved = { ...data, mode: 'updated existing item' }
} else {
  const name = (match.item_name?.trim() || query).slice(0, 120)
  const { data, error } = await supabase
    .from('items')
    .insert({ room_id: roomId, name, priority: 'nice-to-have', ...sourcedFields })
    .select('id, name, status, price_estimate, link, sourced_via, width, depth, height, note')
    .single()
  if (error) throw error
  saved = { ...data, mode: 'created new item' }
}

console.log('OUTCOME: sourced')
console.log('primary:', JSON.stringify(chosen, null, 2))
console.log('alternatives:', JSON.stringify(alternatives.map((a) => ({ title: a.title, retailer: a.retailer, price: a.price, url: a.url })), null, 2))
console.log('\nDB row written:', JSON.stringify(saved, null, 2))
