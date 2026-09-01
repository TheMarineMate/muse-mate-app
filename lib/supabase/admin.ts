import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client — bypasses RLS. Server-only. Never import this into a
 * client component. Used for the atomic project-create RPC path and background
 * jobs where there is no user session to act as.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
