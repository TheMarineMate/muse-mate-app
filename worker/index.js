/* eslint-disable no-restricted-globals */
// Custom service-worker logic merged into the generated SW by
// @ducanh2912/next-pwa (Section 9 — the SW handles push events with the product
// icon). Registration is done in components/ServiceWorkerRegistrar.tsx.

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload = {}
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Muse Mate', body: event.data.text() }
  }

  const title = payload.title || 'Muse Mate'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(target) && 'focus' in client) {
            return client.focus()
          }
        }
        return self.clients.openWindow(target)
      })
  )
})
