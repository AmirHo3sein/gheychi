// Formats the time remaining until an ISO timestamp for the provider stories grid,
// e.g. «۱۸ ساعت مانده» / «۴۵ دقیقه مانده». Shared util so the format stays consistent
// if another surface ever needs it; callers pass their own `now` so a page can drive
// re-renders from a single ticking ref (and tests stay deterministic).
export function formatRemainingTime(expiresAt: string, now: Date = new Date()): string {
  const ms = new Date(expiresAt).getTime() - now.getTime()
  if (ms <= 0) return 'منقضی شده'
  const totalMinutes = Math.ceil(ms / 60_000)
  if (totalMinutes < 60) return `${totalMinutes.toLocaleString('fa-IR')} دقیقه مانده`
  return `${Math.round(totalMinutes / 60).toLocaleString('fa-IR')} ساعت مانده`
}
