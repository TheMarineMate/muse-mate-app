// Local dev helper: create (or reuse) test accounts to sign in with.
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in .env.local.
//
//   npm run dev:seed            -> a signed-in-able owner account
//   npm run dev:seed -- --wipe  -> also delete every project owned by that account first
//
// Prints the email + password to use on /login. Not for production.

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !service) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const admin = createClient(url, service, { auth: { persistSession: false } })

const wipe = process.argv.includes('--wipe')
const ACCOUNTS = [
  { key: 'owner', email: 'dev-owner@musemate.test', password: 'muse-dev-owner-1' },
  { key: 'viewer', email: 'dev-viewer@musemate.test', password: 'muse-dev-viewer-1' },
]

async function findUserByEmail(email) {
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const hit = data.users.find((u) => u.email === email)
    if (hit) return hit
    if (data.users.length < 200) return null
    page++
  }
}

for (const acct of ACCOUNTS) {
  let user = await findUserByEmail(acct.email)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: acct.email,
      password: acct.password,
      email_confirm: true,
    })
    if (error) throw error
    user = data.user
    console.log(`created ${acct.key}: ${acct.email}`)
  } else {
    await admin.auth.admin.updateUserById(user.id, { password: acct.password })
    console.log(`reused  ${acct.key}: ${acct.email}`)
  }

  if (wipe && acct.key === 'owner') {
    const { data: projects } = await admin.from('projects').select('id').eq('owner_id', user.id)
    for (const p of projects ?? []) {
      await admin.from('projects').delete().eq('id', p.id)
    }
    console.log(`  wiped ${projects?.length ?? 0} project(s) owned by ${acct.email}`)
  }
}

console.log('\nsign in at /login with:')
for (const a of ACCOUNTS) console.log(`  ${a.key.padEnd(6)}  ${a.email}  /  ${a.password}`)
