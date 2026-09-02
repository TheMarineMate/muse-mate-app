// RLS + access-control smoke test (Phase 2 proof).
// Requires migrations 001-004 applied and NEXT_PUBLIC_SUPABASE_URL +
// NEXT_PUBLIC_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY in .env.local.
//
//   npm run rls:smoke
//
// Creates owner / editor / viewer / outsider users, each acting through their
// own JWT so RLS applies, and asserts the spec section 7.2 matrix:
//   - owner/editor can write, viewer's writes are rejected AT RLS
//   - non-member sees nothing and can write nothing
//   - create_project() makes the owner membership row atomically
//   - the Section 28 guard triggers hold

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !anon || !service) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(url, service, { auth: { persistSession: false } })

let passed = 0
let failed = 0
function check(label, cond, extra) {
  if (cond) {
    passed++
    console.log(`ok    ${label}`)
  } else {
    failed++
    console.error(`FAIL  ${label}`, extra ?? '')
  }
}
const isRlsDenied = (error) =>
  !!error && (error.code === '42501' || /row-level security/i.test(error.message || ''))

const stamp = Date.now()
const users = {}
async function makeUser(key) {
  const email = `rls+${key}+${stamp}@example.com`
  const password = 'Test-' + crypto.randomUUID()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw new Error(`create ${key}: ${error.message}`)
  const client = createClient(url, anon, { auth: { persistSession: false } })
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password })
  if (signInErr) throw new Error(`sign in ${key}: ${signInErr.message}`)
  users[key] = { id: data.user.id, email, client }
}

let projectId
try {
  await makeUser('owner')
  await makeUser('editor')
  await makeUser('viewer')
  await makeUser('outsider')
  console.log(`created 4 users @ ${stamp}\n`)

  // --- create_project RPC (atomic) ---------------------------------------
  const { data: project, error: cpErr } = await users.owner.client.rpc('create_project', {
    p_name: '  RLS Test Project  ',
    p_budget_target: 1000,
    p_palette: [{ hex: '#A9835C', label: 'Putty' }],
  })
  check('owner: create_project() succeeds', !cpErr && project, cpErr?.message)
  projectId = project?.id
  check('create_project trims the name', project?.name === 'RLS Test Project')
  check('create_project sets owner_id to caller', project?.owner_id === users.owner.id)

  const { data: members } = await admin
    .from('project_members')
    .select('user_id, role, status')
    .eq('project_id', projectId)
  check(
    'owner membership row created atomically (exactly 1, owner/active)',
    members?.length === 1 && members[0].role === 'owner' && members[0].status === 'active' &&
      members[0].user_id === users.owner.id,
    members
  )

  // --- owner adds collaborators ---------------------------------------------
  const { error: addEditorErr } = await users.owner.client.from('project_members').insert({
    project_id: projectId, user_id: users.editor.id, role: 'editor', status: 'active', invited_by: users.owner.id,
  })
  check('owner: add editor collaborator', !addEditorErr, addEditorErr?.message)
  const { error: addViewerErr } = await users.owner.client.from('project_members').insert({
    project_id: projectId, user_id: users.viewer.id, role: 'viewer', status: 'active', invited_by: users.owner.id,
  })
  check('owner: add viewer collaborator', !addViewerErr, addViewerErr?.message)

  // --- SELECT visibility ---------------------------------------------------
  const seesProject = async (u) =>
    (await u.client.from('projects').select('id').eq('id', projectId)).data?.length === 1
  check('viewer: can SELECT the project', await seesProject(users.viewer))
  check('editor: can SELECT the project', await seesProject(users.editor))
  check('outsider: cannot SELECT the project (0 rows)', !(await seesProject(users.outsider)))

  // --- editor writes (allowed) -------------------------------------------
  const { data: room, error: roomErr } = await users.editor.client
    .from('rooms')
    .insert({ project_id: projectId, name: 'Living room', wall_length: 168, wall_width: 144 })
    .select()
    .single()
  check('editor: INSERT room', !roomErr && room, roomErr?.message)

  const { data: item, error: itemErr } = await users.editor.client
    .from('items')
    .insert({ room_id: room?.id, name: 'Sofa', priority: 'must-have', width: 84, depth: 38, height: 34 })
    .select()
    .single()
  check('editor: INSERT item without project_id', !itemErr && item, itemErr?.message)
  check('items_sync_project_id trigger fills project_id from the room', item?.project_id === projectId)

  const { data: placement, error: plErr } = await users.editor.client
    .from('placements')
    .insert({ item_id: item?.id, room_id: room?.id, x: 10, y: 20, rotation: 0 })
    .select()
    .single()
  check('editor: INSERT placement', !plErr && placement, plErr?.message)

  const { data: moved } = await users.editor.client
    .from('placements')
    .update({ x: 40, y: 55 })
    .eq('id', placement?.id)
    .select()
  check('editor: UPDATE placement (move)', moved?.length === 1)

  // --- editor cannot manage collaborators --------------------------------
  const { error: editorAddErr } = await users.editor.client.from('project_members').insert({
    project_id: projectId, user_id: users.outsider.id, role: 'viewer', status: 'active', invited_by: users.editor.id,
  })
  check('editor: INSERT project_members is denied at RLS', isRlsDenied(editorAddErr), editorAddErr)

  // --- viewer writes (all denied) --------------------------------------
  const { error: viewerRoomErr } = await users.viewer.client
    .from('rooms')
    .insert({ project_id: projectId, name: 'Nope' })
  check('viewer: INSERT room denied at RLS', isRlsDenied(viewerRoomErr), viewerRoomErr)

  const { data: viewerMove } = await users.viewer.client
    .from('placements')
    .update({ x: 0, y: 0 })
    .eq('id', placement?.id)
    .select()
  check('viewer: UPDATE placement is a no-op (RLS filters the row)', (viewerMove?.length ?? 0) === 0)

  const { data: viewerDel } = await users.viewer.client
    .from('items')
    .delete()
    .eq('id', item?.id)
    .select()
  check('viewer: DELETE item is a no-op (RLS filters the row)', (viewerDel?.length ?? 0) === 0)

  // --- outsider writes (denied) ---------------------------------------
  const { error: outsiderRoomErr } = await users.outsider.client
    .from('rooms')
    .insert({ project_id: projectId, name: 'Nope' })
  check('outsider: INSERT room denied at RLS', isRlsDenied(outsiderRoomErr), outsiderRoomErr)
  check(
    'outsider: SELECT rooms returns nothing',
    ((await users.outsider.client.from('rooms').select('id').eq('project_id', projectId)).data?.length ?? 0) === 0
  )

  // --- style_references (Phase 6 / migration 006) ----------------------
  const { data: styleRef, error: styleRefErr } = await users.editor.client
    .from('style_references')
    .insert({ project_id: projectId, kind: 'web_link', url: 'https://example.com/mood', caption: 'Warm minimal' })
    .select()
    .single()
  check('editor: INSERT style_references (web_link)', !styleRefErr && styleRef, styleRefErr?.message)

  const { error: styleRefUploadErr } = await users.editor.client
    .from('style_references')
    .insert({ project_id: projectId, kind: 'uploaded_image', storage_path: `${projectId}/abc123.jpg` })
  check('editor: INSERT style_references (uploaded_image w/ storage_path)', !styleRefUploadErr, styleRefUploadErr?.message)

  const { error: styleRefBadKindErr } = await users.editor.client
    .from('style_references')
    .insert({ project_id: projectId, kind: 'web_link', storage_path: `${projectId}/x.jpg` }) // url missing, storage_path set
  check(
    'style_references CHECK rejects kind/location mismatch',
    !!styleRefBadKindErr && /style_references_location_matches_kind|violates check/i.test(styleRefBadKindErr.message || ''),
    styleRefBadKindErr
  )

  check(
    'viewer: can SELECT style_references',
    ((await users.viewer.client.from('style_references').select('id').eq('project_id', projectId)).data?.length ?? 0) >= 1
  )
  const { error: viewerStyleRefErr } = await users.viewer.client
    .from('style_references')
    .insert({ project_id: projectId, kind: 'web_link', url: 'https://example.com/nope' })
  check('viewer: INSERT style_references denied at RLS', isRlsDenied(viewerStyleRefErr), viewerStyleRefErr)

  const { data: viewerStyleDel } = await users.viewer.client
    .from('style_references')
    .delete()
    .eq('id', styleRef?.id)
    .select()
  check('viewer: DELETE style_references is a no-op (RLS filters the row)', (viewerStyleDel?.length ?? 0) === 0)

  check(
    'outsider: SELECT style_references returns nothing',
    ((await users.outsider.client.from('style_references').select('id').eq('project_id', projectId)).data?.length ?? 0) === 0
  )

  // --- Section 28 guards -------------------------------------------------
  const { error: lastOwnerErr } = await users.owner.client
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', users.owner.id)
  check(
    'guard_last_owner blocks removing the only owner',
    !!lastOwnerErr && /last owner/i.test(lastOwnerErr.message || ''),
    lastOwnerErr
  )

  const { data: room2 } = await users.editor.client
    .from('rooms').insert({ project_id: projectId, name: 'Kitchen' }).select().single()
  const { error: mismatchErr } = await users.editor.client
    .from('placements')
    .insert({ item_id: item?.id, room_id: room2?.id, x: 1, y: 1 })
  check(
    'placements_check_item_room rejects a room that is not the item\'s room',
    !!mismatchErr && /match the item/i.test(mismatchErr.message || ''),
    mismatchErr
  )

  // --- owner can delete the whole project ------------------------------
  const { error: delErr } = await users.owner.client.from('projects').delete().eq('id', projectId)
  check('owner: DELETE project', !delErr, delErr?.message)
  const { count } = await admin
    .from('rooms').select('id', { count: 'exact', head: true }).eq('project_id', projectId)
  check('project delete cascades to rooms', (count ?? 0) === 0)
} catch (err) {
  failed++
  console.error('\nEXCEPTION:', err.message ?? err)
} finally {
  if (projectId) await admin.from('projects').delete().eq('id', projectId)
  for (const key of Object.keys(users)) {
    await admin.auth.admin.deleteUser(users[key].id)
  }
  console.log('\ncleaned up test users + data')
}

console.log(`\n${failed === 0 ? 'RLS SMOKE TEST PASSED' : 'RLS SMOKE TEST FAILED'}  (${passed} passed, ${failed} failed)`)
process.exit(failed === 0 ? 0 : 1)
