// Live end-to-end exercise of the style-intake engine (real Anthropic + web
// search + web fetch). Mirrors app/api/style-chat/route.ts's non-HTTP path
// across a multi-turn conversation: each arg after <projectId> is one user
// turn, run in sequence. Pass "new" as the projectId to spin up a throwaway
// Riverhouse project first (and print its id).
//
//   npm run style:live -- new "opener" "reply" "yes, save it"
//   npm run style:live -- <projectId> "let's add more texture"
//
// Requires ANTHROPIC_API_KEY + Supabase vars in .env.local. Spends real money.

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { runStyleTurn } from '../lib/style-engine.ts'
import { buildConfirmedProfile, describeConfirmation, type StyleChatMessage } from '../lib/style.ts'
import type { PaletteEntry } from '../lib/types.ts'

const arg = process.argv[2]
const turns = process.argv.slice(3)
if (!arg || turns.length === 0) {
  console.error('usage: npm run style:live -- <projectId|new> "<turn1>" ["<turn2>" ...]')
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

let projectId = arg
if (arg === 'new') {
  const { data, error } = await supabase.rpc('create_project', {
    p_name: 'The Riverhouse (style-live)',
    p_address: '3765 Ed Smith Ave, Myrtle Beach, SC',
    p_vibe_notes: 'Short-term rental. Needs to photograph bright and actually book.',
  })
  if (error) throw error
  projectId = data.id
  console.log(`created throwaway project ${projectId}\n`)
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'
const history: StyleChatMessage[] = []

for (const userTurn of turns) {
  history.push({ role: 'user', content: userTurn })
  console.log(`\n>>> user: ${userTurn}`)

  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, name, address, vibe_notes, style_summary, palette, prefers_unique, deal_sensitive')
    .eq('id', projectId)
    .maybeSingle()
  if (projErr || !project) throw projErr ?? new Error('project not found')

  const t0 = Date.now()
  const turn = await runStyleTurn({
    client,
    model,
    ctx: {
      projectName: project.name,
      address: project.address ?? null,
      vibeNotes: project.vibe_notes ?? null,
      currentSummary: project.style_summary ?? null,
      currentPalette: (project.palette ?? []) as PaletteEntry[],
      prefersUnique: project.prefers_unique ?? null,
      dealSensitive: project.deal_sensitive ?? null,
    },
    messages: history,
  })
  const secs = Math.round((Date.now() - t0) / 1000)

  if (turn.kind === 'timeout') {
    console.log(`<<< [${secs}s] TIMEOUT`)
    history.push({ role: 'assistant', content: 'That took a while on my end.' })
    continue
  }
  if (turn.kind === 'message') {
    console.log(`<<< [${secs}s] MESSAGE:\n${turn.text}`)
    history.push({ role: 'assistant', content: turn.text })
    continue
  }

  // confirm
  console.log(`<<< [${secs}s] CONFIRM  raw tool input:\n${JSON.stringify(turn.input, null, 2)}`)
  const profile = buildConfirmedProfile(turn.input)
  if (!profile) {
    console.log('    -> rails rejected: nothing usable, treated as a message')
    history.push({ role: 'assistant', content: "Let's keep talking it through." })
    continue
  }

  const patch: Record<string, unknown> = {
    style_summary: profile.style_summary,
    style_confirmed_at: new Date().toISOString(),
  }
  if (profile.prefers_unique !== null) patch.prefers_unique = profile.prefers_unique
  if (profile.deal_sensitive !== null) patch.deal_sensitive = profile.deal_sensitive
  if (profile.palette.length > 0) patch.palette = profile.palette

  const { error: updErr } = await supabase.from('projects').update(patch).eq('id', projectId)
  if (updErr) throw updErr

  if (profile.references.length > 0) {
    const { data: existingRows } = await supabase
      .from('style_references')
      .select('url')
      .eq('project_id', projectId)
    const existing = new Set((existingRows ?? []).map((r: { url: string | null }) => r.url))
    const fresh = profile.references
      .filter((ref) => !existing.has(ref.url))
      .map((ref) => ({ project_id: projectId, kind: ref.kind, url: ref.url, caption: ref.caption }))
    if (fresh.length > 0) {
      const { error: refErr } = await supabase.from('style_references').insert(fresh)
      if (refErr) throw refErr
    }
  }

  const { data: savedProject } = await supabase
    .from('projects')
    .select('style_summary, style_confirmed_at, prefers_unique, deal_sensitive, palette')
    .eq('id', projectId)
    .single()
  const { data: savedRefs } = await supabase
    .from('style_references')
    .select('kind, url, caption')
    .eq('project_id', projectId)

  console.log('    -> WROTE profile:')
  console.log(JSON.stringify({ project: savedProject, style_references: savedRefs }, null, 2))
  console.log(`    -> ${describeConfirmation(profile)}`)
  history.push({ role: 'assistant', content: describeConfirmation(profile) })
}
