// Day boundaries for date-only filters/expiries, computed in Asia/Tehran rather than in the
// browser's timezone. The platform's days (a coupon "valid until 20 Mehr", a bookings range)
// are Iranian days; `new Date('2026-10-12T23:59:59.999')` would silently use whatever zone the
// admin's machine is in (a VPN or a trip abroad shifts every cutoff by hours). The offset is
// looked up through Intl for the given date so pre-2022 dates (Iran still observed DST then)
// are right too, instead of hard-coding +03:30.
const tehranParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Tehran's UTC offset (ms) at the given instant. */
function tehranOffsetMs(instant: number): number {
  const p = Object.fromEntries(tehranParts.formatToParts(new Date(instant)).map((x) => [x.type, x.value]))
  const wallAsUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!)
  return wallAsUtc - (instant - (((instant % 1000) + 1000) % 1000))
}

/** `dateOnly` is `YYYY-MM-DD`; the wall-clock time is read as Tehran time. */
function tehranWallClockToIso(dateOnly: string, h: number, m: number, s: number, ms: number): string {
  const [y, mo, d] = dateOnly.split('-').map(Number)
  const wall = Date.UTC(y!, mo! - 1, d!, h, m, s, ms)
  // Two passes: the first guess uses the offset at the wall time read as UTC, the second
  // corrects it when the true instant sits on the other side of an offset change.
  const first = wall - tehranOffsetMs(wall)
  return new Date(wall - tehranOffsetMs(first)).toISOString()
}

export const startOfTehranDayIso = (dateOnly: string): string => tehranWallClockToIso(dateOnly, 0, 0, 0, 0)
export const endOfTehranDayIso = (dateOnly: string): string => tehranWallClockToIso(dateOnly, 23, 59, 59, 999)
