/**
 * Section 24 — a missing or blank Supabase URL/key makes @supabase/supabase-js
 * throw synchronously. Every call site must check this before creating a client
 * and render <NotConfiguredScreen /> instead of crashing to a blank page.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return Boolean(url && key && /^https?:\/\//.test(url))
}
