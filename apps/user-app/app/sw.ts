import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

// Mirrors apps/api/src/push/push.provider.ts's PushNotificationData -- deliberately not
// imported from the API package since the service worker bundles independently, but the
// shape must stay in sync with it by hand.
interface PushNotificationData {
  type: 'booking'
  bookingId: string
}

interface PushPayload {
  title: string
  body: string
  data?: PushNotificationData
}

// Same UUID shape the backend generates bookings with. Deliberately re-validated here rather
// than trusted from the payload: this is the one guard standing between a push payload and
// self.clients.openWindow(), so a malformed/attacker-controlled bookingId must fail closed
// into the generic /bookings list rather than ever being interpolated into a navigated URL.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const BOOKINGS_LIST_URL = '/bookings'

/**
 * Builds the URL to open for a notification click. Never trusts a raw URL string out of the
 * push payload -- only a `type: 'booking'` + UUID-shaped `bookingId` is enough to construct a
 * same-origin, known-shape path ourselves. Anything else (absent data, wrong type, malformed
 * id -- including legacy/already-queued notifications sent before this field existed) falls
 * back to the pre-existing generic /bookings behavior.
 */
function resolveTargetUrl(data: PushNotificationData | undefined): string {
  if (data && data.type === 'booking' && UUID_RE.test(data.bookingId)) {
    return `/bookings/${data.bookingId}`
  }
  return BOOKINGS_LIST_URL
}

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload: PushPayload
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
      // Round-tripped through the Notification object itself so notificationclick can read
      // it back below without this closure needing to persist anything separately.
      data: payload.data,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = resolveTargetUrl(event.notification.data as PushNotificationData | undefined)
  event.waitUntil(self.clients.openWindow(url))
})
