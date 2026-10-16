// «پیش‌رو / گذشته» on the customer's bookings list -- a client-side split of the one
// /bookings/mine list (the API has no such filter and doesn't need one: a customer's history
// is capped at 500 rows server-side).
export type BookingsTab = 'upcoming' | 'past'

// The statuses that still hold a slot (the API's SLOT_BLOCKING_STATUSES): a request awaiting
// the salon, an unpaid hold, a confirmed appointment. Everything else has reached an outcome.
const ACTIVE_STATUSES = new Set(['pending_approval', 'pending_payment', 'confirmed'])

export function isUpcomingBooking(booking: { status: string; startsAt: string }, now: Date): boolean {
  if (!ACTIVE_STATUSES.has(booking.status)) return false
  const start = new Date(booking.startsAt).getTime()
  // A confirmed appointment whose time has passed (waiting for the salon to mark it done) is
  // history from the customer's point of view, not something coming up.
  return Number.isFinite(start) && start > now.getTime()
}

/** Upcoming soonest-first; past most-recent-first. Never mutates the input. */
export function splitBookings<T extends { status: string; startsAt: string }>(
  bookings: T[],
  now: Date,
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = []
  const past: T[] = []
  for (const b of bookings) (isUpcomingBooking(b, now) ? upcoming : past).push(b)
  const t = (b: T) => new Date(b.startsAt).getTime()
  upcoming.sort((a, b) => t(a) - t(b))
  past.sort((a, b) => t(b) - t(a))
  return { upcoming, past }
}

export function parseBookingsTab(value: unknown): BookingsTab | null {
  return value === 'upcoming' || value === 'past' ? value : null
}
