export const PUSH_PROVIDER = 'PUSH_PROVIDER';

// Structured, deep-link-only metadata -- deliberately minimal and scoped to the one deep-link
// target that exists today (a single booking's detail page). The service worker treats
// `bookingId` as an opaque value it re-validates itself (UUID-shaped) before building a URL
// from it -- it never trusts a full URL string out of the payload. See sw.ts's
// `notificationclick` handler and apps/user-app's /bookings/:id route.
export interface PushNotificationData {
  type: 'booking';
  bookingId: string;
}

export interface PushPayload {
  title: string;
  body: string;
  // Optional so every non-booking / legacy notification (and any already-queued push sent
  // before this field existed) still round-trips fine -- the service worker falls back to
  // the generic /bookings list when this is absent.
  data?: PushNotificationData;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushProvider {
  send(target: PushTarget, payload: PushPayload): Promise<void>;
}
