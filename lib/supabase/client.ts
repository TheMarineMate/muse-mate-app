'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

/**
 * Browser Supabase client. Section 8 — @supabase/ssr stores the session in
 * cookies, which (unlike localStorage) survives Safari -> Add to Home Screen ->
 * standalone PWA. Guard every call site with isSupabaseConfigured() first.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (cached) return cached
  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  return cached
}
