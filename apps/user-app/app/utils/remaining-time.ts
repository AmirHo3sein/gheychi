// Formats the time left until a backend-issued deadline, e.g. «۴۵ دقیقه مانده» /
// «۲ ساعت و ۱۰ دقیقه مانده». Used by the booking approval/payment countdowns, where the
// customer needs a rough sense of urgency -- never a gate: the deadline itself is enforced
// server-side (BookingExpiryJob + the endpoints' own 409s), so this is display only and a
// wrong client clock can at worst mislabel, never block or unblock an action.
//
// Mirrors apps/provider-panel/src/utils/remaining-time.ts's Persian output shape (the
// «... مانده» / «منقضی شده» pair), with one deliberate difference: hours are floored and
// the leftover minutes are spelled out rather than rounded to the nearest hour. Rounding up
// would tell a customer with 89 minutes left that they have «۲ ساعت» -- on a payment window
// that is an overstatement of how long they can wait, and the provider panel's stories grid
// (a 24h TTL, nothing to miss) is the only place that tradeoff was harmless.
//
// `now` is injected by callers so a page can drive every countdown on it from one ticking
// ref (see useNow()) and tests stay deterministic.
export function formatRemainingTime(expiresAt: string, now: Date = new Date()): string {
  const ms = new Date(expiresAt).getTime() - now.getTime()
  // NaN (an unparseable timestamp) fails both comparisons below, so it's caught here rather
  // than being allowed to render as «NaN دقیقه مانده». Treating it as already-expired is the
  // safe direction: the label never promises time the customer might not have.
  if (!Number.isFinite(ms) || ms <= 0) return 'منقضی شده'
  const totalMinutes = Math.ceil(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes.toLocaleString('fa-IR')} دقیقه مانده`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (!minutes) return `${hours.toLocaleString('fa-IR')} ساعت مانده`
  return `${hours.toLocaleString('fa-IR')} ساعت و ${minutes.toLocaleString('fa-IR')} دقیقه مانده`
}
