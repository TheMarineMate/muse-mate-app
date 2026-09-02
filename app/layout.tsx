import type { Metadata, Viewport } from 'next'
import { Fraunces } from 'next/font/google'
import '@intelligent-mate/ui/styles.css'
import './app-tokens.css'
import './globals.css'
import './mm-components.css'
import { ThemeScript } from '@/components/ThemeScript'

// Fraunces — the wordmark + page headers only (see app-tokens.css --font-serif).
// self-hosted by next/font, no runtime <link> or FOUT.
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal'],
  display: 'swap',
  variable: '--font-display',
})
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
  themeColor: '#1b3a5c', // brand Navy — matches the nav bar
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
    <html lang="en" className={fraunces.variable} suppressHydrationWarning>
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
