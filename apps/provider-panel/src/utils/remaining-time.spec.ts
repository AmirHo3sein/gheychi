import { describe, expect, it } from 'vitest'
import { formatRemainingTime } from './remaining-time'

describe('formatRemainingTime', () => {
  const now = new Date('2026-07-17T12:00:00Z')

  it('formats whole hours with Persian digits', () => {
    expect(formatRemainingTime('2026-07-18T06:00:00Z', now)).toBe('۱۸ ساعت مانده')
  })

  // Deliberately floored with minutes (was: rounded to «۲ ساعت مانده»): overstating the time
  // left on a deadline is the wrong direction to be wrong in.
  it('floors partial hours and shows the leftover minutes', () => {
    expect(formatRemainingTime('2026-07-17T13:40:00Z', now)).toBe('۱ ساعت و ۴۰ دقیقه مانده')
    expect(formatRemainingTime('2026-07-17T13:30:00Z', now)).toBe('۱ ساعت و ۳۰ دقیقه مانده')
    expect(formatRemainingTime('2026-07-17T13:59:59Z', now)).toBe('۱ ساعت و ۵۹ دقیقه مانده')
  })

  it('switches to minutes below one hour', () => {
    expect(formatRemainingTime('2026-07-17T12:45:00Z', now)).toBe('۴۵ دقیقه مانده')
  })

  it('reports an already-passed timestamp as expired', () => {
    expect(formatRemainingTime('2026-07-17T11:59:00Z', now)).toBe('منقضی شده')
  })
})
