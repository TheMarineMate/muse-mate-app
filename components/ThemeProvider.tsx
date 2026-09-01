'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { isSupabaseConfigured } from '@/lib/supabase/config'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { THEME_STORAGE_KEY } from './ThemeScript'

type Theme = 'light' | 'dark'

type ThemeContextValue = {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

function applyTheme(t: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', t)
  }
}

function storedTheme(): Theme {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      if (stored === 'dark' || stored === 'light') return stored
    } catch {
      // storage disabled — fall through to the default
    }
  }
  return 'light' // Section 2 — light is always the default
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')

  // The FOUC script (ThemeScript) pins data-theme before first paint, but React
  // drops attributes it didn't render from <html> during hydration. Re-pin from
  // the persisted preference right after mount so the attribute survives.
  useEffect(() => {
    const initial = storedTheme()
    applyTheme(initial)
    setThemeState(initial)
  }, [])

  // Section 2 — when signed in, the user_settings row is the source of truth so
  // the preference follows the user across devices.
  useEffect(() => {
    if (!isSupabaseConfigured()) return
    const supabase = getSupabaseBrowserClient()
    let active = true

    supabase.auth.getUser().then(async ({ data }) => {
      if (!active || !data.user) return
      const { data: row } = await supabase
        .from('user_settings')
        .select('theme')
        .eq('user_id', data.user.id)
        .maybeSingle()
      if (active && row && (row.theme === 'light' || row.theme === 'dark')) {
        applyTheme(row.theme)
        setThemeState(row.theme)
        try {
          localStorage.setItem(THEME_STORAGE_KEY, row.theme)
        } catch {
          // private mode / storage disabled — the attribute is still correct
        }
      }
    })

    return () => {
      active = false
    }
  }, [])

  const setTheme = useCallback((t: Theme) => {
    applyTheme(t)
    setThemeState(t)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t)
    } catch {
      // ignore
    }
    if (!isSupabaseConfigured()) return
    const supabase = getSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return
      return supabase
        .from('user_settings')
        .upsert({ user_id: data.user.id, theme: t }, { onConflict: 'user_id' })
    })
  }, [])

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}
