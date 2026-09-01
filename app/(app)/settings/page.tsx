'use client'

import { useRouter } from 'next/navigation'
import { Button, Card } from '@intelligent-mate/ui'
import { useTheme } from '@/components/ThemeProvider'
import { ThemeToggle } from '@/components/ThemeToggle'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

export default function SettingsPage() {
  const router = useRouter()
  const { theme } = useTheme()

  async function signOut() {
    if (isSupabaseConfigured()) {
      await getSupabaseBrowserClient().auth.signOut()
    }
    router.replace('/login')
  }

  return (
    <div className="mm-stack">
      <h1 className="mm-page-title">Settings</h1>

      <Card padding="lg">
        <div className="mm-row-between">
          <div>
            <div className="mm-field-label">Appearance</div>
            <div className="mm-muted">
              Currently {theme}. Syncs across your devices when you&apos;re signed in.
            </div>
          </div>
          <ThemeToggle />
        </div>
      </Card>

      <Card padding="lg">
        <div className="mm-row-between">
          <div>
            <div className="mm-field-label">Session</div>
            <div className="mm-muted">Sign out of Muse Mate on this device.</div>
          </div>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  )
}
