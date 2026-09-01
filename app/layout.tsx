import type { Metadata, Viewport } from 'next'
import '@intelligent-mate/ui/styles.css'
import './app-tokens.css'
import './globals.css'
import { ThemeScript } from '@/components/ThemeScript'
import { ThemeProvider } from '@/components/ThemeProvider'
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar'
import { APP_URL } from '@/lib/env'

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: 'Muse Mate',
  description: 'Design-project tracker — rooms, sourcing, and to-scale layout.',
  applicationName: 'Muse Mate',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Muse Mate' },
}

export const viewport: Viewport = {
  themeColor: '#0f1f3d',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Section 2 — must run before first paint. As the first <body> child it
            executes synchronously before the rest of the tree renders. */}
        <ThemeScript />
        <ThemeProvider>
          {children}
          <ServiceWorkerRegistrar />
        </ThemeProvider>
      </body>
    </html>
  )
}
