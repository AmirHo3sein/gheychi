import { describe, it, expect } from 'vitest'
import { formatRemainingTime } from '../../app/utils/remaining-time'

const NOW = new Date('2026-07-20T12:00:00.000Z')

describe('formatRemainingTime', () => {
  it('counts down in minutes under an hour', () => {
    expect(formatRemainingTime('2026-07-20T12:45:00.000Z', NOW)).toBe('۴۵ دقیقه مانده')
    expect(formatRemainingTime('2026-07-20T12:00:30.000Z', NOW)).toBe('۱ دقیقه مانده')
  })

  it('reports whole hours without a redundant zero-minute tail', () => {
    expect(formatRemainingTime('2026-07-20T14:00:00.000Z', NOW)).toBe('۲ ساعت مانده')
    expect(formatRemainingTime('2026-07-20T13:00:00.000Z', NOW)).toBe('۱ ساعت مانده')
  })

  // The one deliberate divergence from provider-panel's version of this util: it rounds to
  // the nearest hour, which would turn 89 remaining minutes into «۲ ساعت» -- an
  // overstatement of a payment window the customer could then miss.
  it('spells out the leftover minutes instead of rounding the hour up', () => {
    expect(formatRemainingTime('2026-07-20T13:29:00.000Z', NOW)).toBe('۱ ساعت و ۲۹ دقیقه مانده')
    expect(formatRemainingTime('2026-07-20T13:59:00.000Z', NOW)).toBe('۱ ساعت و ۵۹ دقیقه مانده')
  })

  it('says منقضی شده at and past the deadline rather than counting into negatives', () => {
    expect(formatRemainingTime('2026-07-20T12:00:00.000Z', NOW)).toBe('منقضی شده')
    expect(formatRemainingTime('2026-07-20T11:30:00.000Z', NOW)).toBe('منقضی شده')
  })

  // An unparseable timestamp yields NaN, which passes neither comparison on its own -- it
  // must not reach the formatter and render as «NaN دقیقه مانده».
  it('degrades to منقضی شده for an unparseable timestamp instead of rendering NaN', () => {
    expect(formatRemainingTime('not-a-date', NOW)).toBe('منقضی شده')
  })

  it('defaults `now` to the real clock when no injection point is given', () => {
    expect(formatRemainingTime(new Date(Date.now() + 10 * 60_000).toISOString())).toBe('۱۰ دقیقه مانده')
  })
})
