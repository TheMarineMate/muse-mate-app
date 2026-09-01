'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/settings', label: 'Settings' },
]

export function BottomNav() {
  const pathname = usePathname()
  return (
    <nav className="mm-bottomnav">
      {LINKS.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`)
        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              active
                ? 'mm-bottomnav__link mm-bottomnav__link--active'
                : 'mm-bottomnav__link'
            }
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
