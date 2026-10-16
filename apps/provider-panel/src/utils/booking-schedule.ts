// Date and geometry helpers for BookingsView's day/week time grid. Every "day" here is a
// salon (Asia/Tehran) calendar day as a Gregorian 'YYYY-MM-DD' key -- the same key shape
// tehranDateString/JalaliDatePicker use -- and every instant is a real UTC ISO string.
import { startOfTehranDayIso } from './tehran-day'

export type ScheduleMode = 'day' | 'week'

/** 'YYYY-MM-DD' + n calendar days. Pure date arithmetic, no timezone involved. */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days))
  return dt.toISOString().slice(0, 10)
}

/** The Saturday that opens the Iranian week containing `key`. */
export function weekStartKey(key: string): string {
  const dow = new Date(`${key}T12:00:00Z`).getUTCDay() // 0 = Sunday .. 6 = Saturday
  return addDaysToKey(key, -((dow + 1) % 7))
}

export function visibleDays(mode: ScheduleMode, key: string): string[] {
  if (mode === 'day') return [key]
  const start = weekStartKey(key)
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(start, i))
}

/**
 * The [from, to) window GET /salons/mine/bookings?from&to is asked for: Tehran midnight of the
 * first visible day to Tehran midnight after the last one (the API filters on starts_at).
 */
export function rangeQuery(days: string[]): { from: string; to: string } {
  return {
    from: startOfTehranDayIso(days[0]!),
    to: startOfTehranDayIso(addDaysToKey(days[days.length - 1]!, 1)),
  }
}

/** Minutes since Tehran midnight of `dayKey` (may be negative or > 1440 for neighbours). */
export function minutesIntoDay(iso: string, dayKey: string): number {
  return Math.round((Date.parse(iso) - Date.parse(startOfTehranDayIso(dayKey))) / 60_000)
}

export interface Interval {
  id: string
  start: number // minutes
  end: number
}

export interface PlacedInterval extends Interval {
  lane: number
  lanes: number
}

/**
 * Side-by-side lanes for overlapping appointments in one column (a salon with capacity > 1
 * can legitimately hold several at once). Greedy first-fit inside each overlap cluster; every
 * member of a cluster shares that cluster's lane count so widths line up.
 */
export function placeIntervals(items: Interval[]): PlacedInterval[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: PlacedInterval[] = []
  let cluster: PlacedInterval[] = []
  let laneEnds: number[] = []
  let clusterEnd = -Infinity

  const flush = () => {
    for (const p of cluster) p.lanes = laneEnds.length
    out.push(...cluster)
    cluster = []
    laneEnds = []
  }

  for (const it of sorted) {
    if (cluster.length > 0 && it.start >= clusterEnd) {
      flush()
      clusterEnd = -Infinity
    }
    let lane = laneEnds.findIndex((end) => end <= it.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(it.end)
    } else {
      laneEnds[lane] = it.end
    }
    cluster.push({ ...it, lane, lanes: 1 })
    clusterEnd = Math.max(clusterEnd, it.end)
  }
  if (cluster.length > 0) flush()
  return out
}

/**
 * Vertical extent of the grid in minutes: a 09:00-21:00 frame (a typical salon day) widened
 * to whole hours so every visible appointment fits. Only a frame -- it claims nothing about
 * the salon's real opening hours.
 */
export function gridBounds(intervals: Array<{ start: number; end: number }>): { start: number; end: number } {
  let start = 9 * 60
  let end = 21 * 60
  for (const iv of intervals) {
    start = Math.min(start, Math.floor(Math.max(0, iv.start) / 60) * 60)
    end = Math.max(end, Math.ceil(Math.min(24 * 60, iv.end) / 60) * 60)
  }
  return { start, end: Math.max(end, start + 60) }
}
