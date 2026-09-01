import withPWAInit from '@ducanh2912/next-pwa'

// Section 25 — the PWA only counts if withPWA() is actually called and the
// service worker registers against a real production build. Disabled in dev so
// stale SW caching doesn't create phantom bugs.
const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: false, // registered manually in ServiceWorkerRegistrar
  cacheOnFrontEndNav: true,
  workboxOptions: {
    runtimeCaching: [
      {
        // Section 25 — API responses must never be served stale.
        urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
        handler: 'NetworkOnly',
      },
    ],
  },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Local file: dependency that ships its own 'use client' modules.
  transpilePackages: ['@intelligent-mate/ui'],
  webpack: (config) => {
    // konva has an optional Node "canvas" dep it never needs in the browser.
    config.resolve.alias = { ...config.resolve.alias, canvas: false }
    return config
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ]
  },
}

export default withPWA(nextConfig)
