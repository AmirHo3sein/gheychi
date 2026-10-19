/* apps/provider-panel/public/sw.js
 *
 * The provider panel's service worker: web push for salon owners, nothing else (no caching --
 * the panel is an authenticated, always-online tool, and a stale cached shell is worse than a
 * network error). Plain JS served as-is from /sw.js so its URL never changes between builds;
 * nginx serves it with no-cache (docker/nginx-spa.conf) so an update is picked up at once.
 *
 * Payloads come from the API's notifyOwner() (apps/api/src/booking/payments.service.ts):
 * { title, body, data: { type: 'salon-booking', bookingId } }. Only provider-audience
 * subscriptions receive them, so a customer notification never lands here.
 */

/** Where a notification click goes. Never trusts a URL from the payload -- only known shapes. */
function targetPath(data) {
  if (data && data.type === 'salon-booking') return '/bookings'
  return '/'
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let payload
  try {
    payload = event.data ? event.data.json() : null
  } catch {
    payload = null
  }
  // Always show something: browsers penalise a push that results in no visible notification.
  const title = (payload && typeof payload.title === 'string' && payload.title) || 'اعلان جدید از قیچی'
  const body = (payload && typeof payload.body === 'string' && payload.body) || ''
  const tag = payload && payload.data && payload.data.bookingId ? `booking-${payload.data.bookingId}` : undefined
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      lang: 'fa',
      dir: 'rtl',
      icon: '/brand-icon.png',
      badge: '/favicon.png',
      // One notification per booking: a reschedule or cancel replaces the earlier one -- and
      // still alerts the owner (renotify), since a freed or moved slot is news.
      tag,
      renotify: !!tag,
      data: payload ? payload.data : undefined,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(targetPath(event.notification.data), self.location.origin).href
  event.waitUntil(
    (async () => {
      // Reuse an open panel tab rather than stacking new ones.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus()
          if ('navigate' in client) await client.navigate(url).catch(() => {})
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})
