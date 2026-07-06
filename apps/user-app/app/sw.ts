import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload: { title: string; body: string }
  try {
    payload = event.data.json()
  } catch {
    // Malformed/truncated payload -- still show a notification. Browsers (notably Chrome)
    // track "silent" pushes per subscription and can inject a generic background-update
    // notification or throttle/revoke the subscription if pushes don't reliably result in
    // a shown notification.
    payload = { title: 'اعلان جدید', body: '' }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192.png',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow('/bookings'))
})
