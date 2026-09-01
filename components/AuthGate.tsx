'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isInAppBrowser } from '@/lib/inAppBrowser'
import { NotConfiguredScreen } from './NotConfiguredScreen'
import { InAppBrowserNotice } from './InAppBrowserNotice'
import { FullPageSpinner } from './FullPageSpinner'

type Status = 'loading' | 'authed' | 'anon'

/**
 * Section 8 — client-side auth gate wrapping the app (not middleware.ts).
 * Also enforces Section 24 (config guard) and the in-app-browser screen before
 * any Supabase call is attempted.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const configured = isSupabaseConfigured()
  const inApp =
    typeof navigator !== 'undefined' && isInAppBrowser(navigator.userAgent)

  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    if (!configured || inApp) return
    const supabase = getSupabaseBrowserClient()
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (active) setStatus(data.session ? 'authed' : 'anon')
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setStatus(session ? 'authed' : 'anon')
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [configured, inApp])

  useEffect(() => {
    if (status === 'anon') router.replace('/login')
  }, [status, router])

  if (!configured) return <NotConfiguredScreen />
  if (inApp) return <InAppBrowserNotice />
  if (status !== 'authed') return <FullPageSpinner />
  return <>{children}</>
}
