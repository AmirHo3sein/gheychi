// Formats the time remaining until an ISO timestamp for the provider stories grid,
// e.g. «۱۸ ساعت مانده» / «۱ ساعت و ۳۰ دقیقه مانده» / «۴۵ دقیقه مانده». Shared util so the format stays consistent
// if another surface ever needs it; callers pass their own `now` so a page can drive
// re-renders from a single ticking ref (and tests stay deterministic).
export function formatRemainingTime(expiresAt: string, now: Date = new Date()): string {
  const ms = new Date(expiresAt).getTime() - now.getTime()
  if (ms <= 0) return 'منقضی شده'
  if (ms < 3_600_000) return `${Math.ceil(ms / 60_000).toLocaleString('fa-IR')} دقیقه مانده`
  return `${formatHoursMinutes(ms)} مانده`
}

/**
 * «۱ ساعت و ۳۰ دقیقه» / «۱۸ ساعت» for a span of an hour or more. Floors -- never rounds up:
 * on a deadline, overstating the time left is the wrong direction to be wrong in.
 */
export function formatHoursMinutes(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  const hours = `${h.toLocaleString('fa-IR')} ساعت`
  return m === 0 ? hours : `${hours} و ${m.toLocaleString('fa-IR')} دقیقه`
}
