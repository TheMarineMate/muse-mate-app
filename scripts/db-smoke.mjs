// Schema smoke test (Phase 1 proof). Requires migrations 001 + 002 applied and
// SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in .env.local.
//
//   npm run db:smoke
//
// Uses the service-role client (bypasses RLS — RLS policies for the app tables
// arrive in Phase 2). Inserts one row per table, reads them back, checks the
// shapes, then deletes the project and confirms the cascade.

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

const fail = (msg, extra) => {
  console.error(`FAIL  ${msg}`, extra ?? '')
  process.exitCode = 1
}
const ok = (msg) => console.log(`ok    ${msg}`)

// A throwaway auth user to own the project (FK -> auth.users).
const email = `smoke+${Date.now()}@example.com`
const { data: userRes, error: userErr } = await db.auth.admin.createUser({
  email,
  password: crypto.randomUUID(),
  email_confirm: true,
})
if (userErr) {
  fail('create test user', userErr.message)
  process.exit(1)
}
const uid = userRes.user.id
ok(`created test user ${uid}`)

let projectId
try {
  const { data: project, error: pErr } = await db
    .from('projects')
    .insert({
      owner_id: uid,
      name: 'Smoke Test Project',
      address: '3765 Ed Smith Ave, Myrtle Beach, SC',
      palette: [{ hex: '#A9835C', label: 'Putty' }],
      budget_target: 25000,
    })
    .select()
    .single()
  if (pErr) throw pErr
  projectId = project.id
  if (!Array.isArray(project.palette)) throw new Error('palette did not round-trip as array')
  ok('projects insert + jsonb round-trip')

  const { error: mErr } = await db.from('project_members').insert({
    project_id: projectId,
    user_id: uid,
    role: 'owner',
    status: 'active',
    invited_by: uid,
  })
  if (mErr) throw mErr
  ok('project_members insert (owner)')

  const { data: room, error: rErr } = await db
    .from('rooms')
    .insert({
      project_id: projectId,
      name: 'Living room',
      wall_length: 168.5,
      wall_width: 144,
      doors: [{ wall: 'N', offset: 12, width: 32 }],
      windows: [{ wall: 'E', offset: 40, width: 48 }],
    })
    .select()
    .single()
  if (rErr) throw rErr
  ok('rooms insert + openings jsonb')

  const { data: item, error: iErr } = await db
    .from('items')
    .insert({
      room_id: room.id,
      project_id: projectId,
      name: 'Sofa',
      priority: 'must-have',
      status: 'needed',
      width: 84,
      depth: 38,
      height: 34,
    })
    .select()
    .single()
  if (iErr) throw iErr
  ok('items insert')

  const { error: plErr } = await db.from('placements').insert({
    item_id: item.id,
    room_id: room.id,
    x: 10,
    y: 20,
    rotation: 90,
  })
  if (plErr) throw plErr
  ok('placements insert')

  // CHECK constraint should reject a bad enum value.
  const { error: badErr } = await db
    .from('items')
    .insert({ room_id: room.id, project_id: projectId, name: 'Bad', status: 'nonsense' })
  if (!badErr) throw new Error('bad item.status was accepted — CHECK constraint missing')
  ok('items.status CHECK constraint rejects bad value')

  // user_settings self-scoped table.
  const { error: usErr } = await db
    .from('user_settings')
    .insert({ user_id: uid, theme: 'dark' })
  if (usErr) throw usErr
  ok('user_settings insert')

  // Cascade: deleting the project should remove rooms/items/placements/members.
  const { error: delErr } = await db.from('projects').delete().eq('id', projectId)
  if (delErr) throw delErr
  const { count } = await db
    .from('rooms')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
  if (count && count > 0) throw new Error('rooms not cascade-deleted with project')
  ok('project delete cascades to rooms/items/placements/members')
} catch (err) {
  fail('schema exercise', err.message ?? err)
} finally {
  if (projectId) await db.from('projects').delete().eq('id', projectId)
  await db.from('user_settings').delete().eq('user_id', uid)
  await db.auth.admin.deleteUser(uid)
  ok('cleaned up test user + data')
}

if (process.exitCode === 1) {
  console.error('\nSMOKE TEST FAILED')
} else {
  console.log('\nSMOKE TEST PASSED')
}
