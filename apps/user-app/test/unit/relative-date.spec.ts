import { describe, it, expect } from 'vitest'
import { formatRelativeDate } from '../../app/utils/relative-date'

const NOW = new Date('2026-07-20T12:00:00.000Z')

describe('formatRelativeDate', () => {
  it('says "just now" for a timestamp under a minute old', () => {
    expect(formatRelativeDate('2026-07-20T11:59:40.000Z', NOW)).toBe('همین دقیقه')
  })

  // Each step picks the LARGEST unit the gap already clears -- a 10-day-old review reports
  // in weeks ("۱۰ روز" would undercount how it actually reads), not days.
  it('steps up through minutes, hours, weeks, months, and years -- always the largest unit that fits', () => {
    expect(formatRelativeDate('2026-07-20T11:55:00.000Z', NOW)).toBe('۵ دقیقه پیش')
    expect(formatRelativeDate('2026-07-20T09:00:00.000Z', NOW)).toBe('۳ ساعت پیش')
    expect(formatRelativeDate('2026-07-19T12:00:00.000Z', NOW)).toBe('دیروز')
    expect(formatRelativeDate('2026-07-10T12:00:00.000Z', NOW)).toBe('هفتهٔ گذشته')
    expect(formatRelativeDate('2026-06-20T12:00:00.000Z', NOW)).toBe('ماه گذشته')
    expect(formatRelativeDate('2024-07-20T12:00:00.000Z', NOW)).toBe('۲ سال پیش')
  })
})
