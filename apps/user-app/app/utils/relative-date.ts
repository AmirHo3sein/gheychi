// "چند روز پیش" style relative timestamps -- used on review cards, where an absolute date
// is less scannable than "how long ago" at a glance. `now` is an optional injection point so
// callers (and this file's own unit tests) don't depend on the real wall clock.
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
]

const formatter = new Intl.RelativeTimeFormat('fa-IR', { numeric: 'auto' })

export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const diffSeconds = (new Date(iso).getTime() - now.getTime()) / 1000
  const absSeconds = Math.abs(diffSeconds)
  for (const [unit, secondsInUnit] of UNITS) {
    if (absSeconds >= secondsInUnit) return formatter.format(Math.round(diffSeconds / secondsInUnit), unit)
  }
  // Under a minute -- "just now" reads better than "0 minutes ago" for a review that was
  // (practically impossibly, but not worth a special guard) submitted seconds ago.
  return formatter.format(0, 'minute')
}
