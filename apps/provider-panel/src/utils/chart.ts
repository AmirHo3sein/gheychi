// Pure helpers behind the dashboard's hand-rolled SVG charts (components/dashboard/charts).
// Kept framework-free so the maths is unit-tested on its own.

/**
 * A "nice" y-axis: an upper bound and step built from 1/2/2.5/5 × 10^n, so gridlines land on
 * round values (0, 250k, 500k …) instead of 0, 237k, 474k. `integer` forbids fractional steps
 * for counts -- "۱٫۵ نوبت" is not a thing. An all-zero series still gets a visible scale.
 */
export function niceScale(maxValue: number, tickCount = 4, integer = false): { max: number; step: number } {
  const raw = Math.max(0, maxValue) / tickCount
  if (raw === 0) {
    const step = integer ? 1 : 1
    return { max: step * tickCount, step }
  }
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / magnitude
  const factor = [1, 2, 2.5, 5, 10].find((f) => normalized <= f) ?? 10
  let step = factor * magnitude
  if (integer) step = Math.max(1, Math.ceil(step))
  return { max: step * tickCount, step }
}

export interface Pt {
  x: number
  y: number
}

/**
 * Monotone cubic (Fritsch–Carlson) path through points sorted by ascending x. Smooth like a
 * spline, but it never overshoots: a day with 0 bookings between two busy ones dips to the
 * baseline, never below it, and a peak is never drawn higher than the real value.
 */
export function monotonePath(points: Pt[]): string {
  const n = points.length
  if (n === 0) return ''
  if (n === 1) return `M${r(points[0]!.x)},${r(points[0]!.y)}`
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1]!.x - points[i]!.x)
    slope.push((points[i + 1]!.y - points[i]!.y) / (dx[i] || 1))
  }
  const tangent: number[] = [slope[0]!]
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1]!
    const b = slope[i]!
    tangent.push(a * b <= 0 ? 0 : (3 * (dx[i - 1]! + dx[i]!)) / ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b))
  }
  tangent.push(slope[n - 2]!)
  let d = `M${r(points[0]!.x)},${r(points[0]!.y)}`
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i]!
    const p1 = points[i + 1]!
    const h = dx[i]! / 3
    d += `C${r(p0.x + h)},${r(p0.y + h * tangent[i]!)},${r(p1.x - h)},${r(p1.y - h * tangent[i + 1]!)},${r(p1.x)},${r(p1.y)}`
  }
  return d
}

function r(n: number): string {
  return (Math.round(n * 10) / 10).toString()
}

/** Up to `max` evenly spread indices of an n-point axis, always including both ends. */
export function labelIndices(n: number, max: number): number[] {
  if (n <= 0) return []
  if (n === 1 || max <= 1) return [n - 1]
  const count = Math.min(n, Math.max(2, max))
  const out = new Set<number>()
  for (let k = 0; k < count; k++) out.add(Math.round((k * (n - 1)) / (count - 1)))
  return [...out]
}

const compactFmt = new Intl.NumberFormat('fa-IR', { notation: 'compact', maximumFractionDigits: 1 })
/** Axis-sized money/count label: «۱٫۲ میلیون», «۵۰۰ هزار». */
export function formatCompact(value: number): string {
  return compactFmt.format(value)
}

/** 'YYYY-MM-DD' Tehran calendar date → a Date at Tehran noon (safe from any day rollover). */
export function tehranNoon(date: string): Date {
  return new Date(`${date}T12:00:00+03:30`)
}
