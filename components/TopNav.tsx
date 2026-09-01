'use client'

import Link from 'next/link'
import { ThemeToggle } from './ThemeToggle'

export function TopNav() {
  return (
    <header className="mm-topnav">
      <Link href="/dashboard" className="mm-topnav__brand">
        Muse Mate
      </Link>
      <ThemeToggle />
    </header>
  )
}
