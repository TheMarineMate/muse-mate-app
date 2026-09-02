// Live end-to-end exercise of the style-intake engine (real Anthropic + web
// search + web fetch + multimodal image input). Mirrors
// app/api/style-chat/route.ts's non-HTTP path across a multi-turn conversation:
// each arg after <projectId> is one user turn, run in sequence. Pass "new" as
// the projectId to spin up a throwaway Riverhouse project first.
//
// Attach a local image to the FIRST user turn with --image <path> (repeatable):
//   npm run style:live -- new --image ./ref.jpg "what does this room read like to you?" "save it"
//
// Requires ANTHROPIC_API_KEY + Supabase vars in .env.local. Spends real money.

import { readFile } from 'node:fs/promises'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { runStyleTurn, type StyleTurnImage, type StyleTurnMessage } from '../lib/style-engine.ts'
import {
  buildConfirmedProfile,
  describeConfirmation,
  mediaTypeFromPath,
  storageKeyForUpload,
} from '../lib/style.ts'
import type { PaletteEntry } from '../lib/types.ts'

const BUCKET = 'style-references'

const rawArgs = process.argv.slice(2)
const imagePaths: string[] = []
const positional: string[] = []
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--image') {
    const p = rawArgs[++i]
    if (p) imagePaths.push(p)
  } else {
    positional.push(rawArgs[i])
  }
}
const arg = positional[0]
const turns = positional.slice(1)
if (!arg || turns.length === 0) {
  console.error('usage: npm run style:live -- <projectId|new> [--image <path>] "<turn1>" ["<turn2>" ...]')
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

// Upload any --image files to Storage + persist the uploaded_image rows, then
// attach their keys to the first user turn.
const firstTurnAttachments: string[] = []
for (const path of imagePaths) {
  const mime = mediaTypeFromPath(path)
  if (!mime) {
    console.error(`skipping ${path}: not a supported image extension`)
    continue
  }
  const bytes = await readFile(path)
  const key = storageKeyForUpload(projectId, mime)
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(key, bytes, { contentType: mime, upsert: false })
  if (upErr) throw upErr
  const { error: rowErr } = await supabase
    .from('style_references')
    .insert({ project_id: projectId, kind: 'uploaded_image', storage_path: key })
  if (rowErr) throw rowErr
  firstTurnAttachments.push(key)
  console.log(`uploaded ${path} -> ${key}`)
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'

type WireMsg = { role: 'user' | 'assistant'; content: string; attachments?: string[] }
const history: WireMsg[] = []

/** Same resolution the route does: Storage key -> inline base64 image. */
async function resolve(msgs: WireMsg[]): Promise<StyleTurnMessage[]> {
  const out: StyleTurnMessage[] = []
  for (const m of msgs) {
    if (m.role === 'assistant' || !m.attachments?.length) {
      out.push({ role: m.role, content: m.content })
      continue
    }
    const images: StyleTurnImage[] = []
    for (const key of m.attachments) {
      const media_type = mediaTypeFromPath(key)
      if (!media_type) continue
      const { data, error } = await supabase.storage.from(BUCKET).download(key)
      if (error || !data) {
        console.error(`  download failed for ${key}: ${error?.message}`)
        continue
      }
      const b64 = Buffer.from(await data.arrayBuffer()).toString('base64')
      images.push({ media_type, data: b64 })
    }
    out.push({ role: 'user', content: m.content, images })
  }
  return out
}

for (let t = 0; t < turns.length; t++) {
  const userTurn = turns[t]
  const attachments = t === 0 && firstTurnAttachments.length > 0 ? firstTurnAttachments : undefined
  history.push({ role: 'user', content: userTurn, ...(attachments ? { attachments } : {}) })
  console.log(`\n>>> user: ${userTurn}${attachments ? `  [+${attachments.length} image]` : ''}`)

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
    messages: await resolve(history),
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
    .select('kind, url, caption, storage_path')
    .eq('project_id', projectId)

  console.log('    -> WROTE profile:')
  console.log(JSON.stringify({ project: savedProject, style_references: savedRefs }, null, 2))
  console.log(`    -> ${describeConfirmation(profile)}`)
  history.push({ role: 'assistant', content: describeConfirmation(profile) })
}
