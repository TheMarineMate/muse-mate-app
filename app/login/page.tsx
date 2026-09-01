'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Input, PasswordInput } from '@intelligent-mate/ui'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isInAppBrowser } from '@/lib/inAppBrowser'
import { NotConfiguredScreen } from '@/components/NotConfiguredScreen'
import { InAppBrowserNotice } from '@/components/InAppBrowserNotice'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!isSupabaseConfigured()) return <NotConfiguredScreen />
  if (typeof navigator !== 'undefined' && isInAppBrowser(navigator.userAgent)) {
    return <InAppBrowserNotice />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const supabase = getSupabaseBrowserClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setBusy(false)
    if (signInError) {
      setError("That email and password combination didn't work.")
      return
    }
    router.replace('/dashboard')
  }

  return (
    <div className="mm-auth">
      <Card padding="lg" className="mm-auth__card">
        <h1 className="mm-auth__title">Sign in to Muse Mate</h1>
        <p className="mm-auth__sub">
          Access is by invite. Use the email your project owner added.
        </p>
        <form className="mm-auth__form" onSubmit={onSubmit}>
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? undefined}
          />
          <Button type="submit" loading={busy} fullWidth>
            Sign in
          </Button>
        </form>
      </Card>
    </div>
  )
}
