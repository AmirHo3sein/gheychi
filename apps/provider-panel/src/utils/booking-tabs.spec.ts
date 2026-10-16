import { describe, expect, it } from 'vitest'
import { bookingsForTab, dateTabFor, defaultTab, formatCountdown, isBookingTab, needsActionCount, needsOutcome, tabFor } from './booking-tabs'

// 2026-10-16 12:00 Tehran (+03:30) -- every assertion uses fixed instants, so it holds under any machine TZ.
const NOW = new Date('2026-10-16T08:30:00.000Z')
const ctx = { now: NOW, canMarkOutcome: true }
const b = (id: string, startsAt: string, status = 'confirmed') => ({ id, startsAt, status })

describe('booking-tabs', () => {
  it('classifies by the Tehran calendar day, not the UTC one', () => {
    // 23:00 Tehran on the 16th is 19:30Z -- still "today".
    expect(dateTabFor(b('a', '2026-10-16T19:30:00.000Z'), NOW)).toBe('today')
    // 00:30 Tehran on the 17th is 21:00Z on the 16th in UTC -- already "upcoming".
    expect(dateTabFor(b('a', '2026-10-16T21:00:00.000Z'), NOW)).toBe('upcoming')
    expect(dateTabFor(b('a', '2026-10-15T08:00:00.000Z'), NOW)).toBe('past')
  })

  it('owes an outcome only for a started, confirmed booking at an approved salon', () => {
    expect(needsOutcome(b('a', '2026-10-16T06:00:00.000Z'), ctx)).toBe(true)
    expect(needsOutcome(b('a', '2026-10-16T10:00:00.000Z'), ctx)).toBe(false) // not started
    expect(needsOutcome(b('a', '2026-10-01T06:00:00.000Z', 'completed'), ctx)).toBe(false)
    expect(needsOutcome(b('a', '2026-10-16T06:00:00.000Z'), { ...ctx, canMarkOutcome: false })).toBe(false)
  })

  it('counts pending requests and owed outcomes together, but lists only the outcome cards', () => {
    const list = [
      b('req', '2026-10-20T06:00:00.000Z', 'pending_approval'),
      b('owed', '2026-10-10T06:00:00.000Z'),
      b('later', '2026-10-20T06:00:00.000Z'),
    ]
    expect(needsActionCount(list, ctx)).toBe(2)
    expect(bookingsForTab(list, 'needs-action', ctx).map((x) => x.id)).toEqual(['owed'])
    expect(bookingsForTab(list, 'upcoming', ctx).map((x) => x.id)).toEqual(['req', 'later'])
  })

  it('lands on the most urgent non-empty tab', () => {
    expect(defaultTab([], ctx)).toBe('today')
    expect(defaultTab([b('p', '2026-10-01T06:00:00.000Z', 'completed')], ctx)).toBe('past')
    expect(defaultTab([b('u', '2026-10-20T06:00:00.000Z'), b('p', '2026-10-01T06:00:00.000Z', 'completed')], ctx)).toBe('upcoming')
    expect(defaultTab([b('u', '2026-10-20T06:00:00.000Z', 'pending_approval')], ctx)).toBe('needs-action')
  })

  it('sends a fresh booking to the tab where it can be seen', () => {
    expect(tabFor(b('a', '2026-10-20T06:00:00.000Z'), ctx)).toBe('upcoming')
    expect(tabFor(b('a', '2026-10-10T06:00:00.000Z'), ctx)).toBe('needs-action')
    expect(tabFor(b('a', '2026-10-20T06:00:00.000Z', 'pending_approval'), ctx)).toBe('needs-action')
  })

  it('validates a ?tab= value', () => {
    expect(isBookingTab('past')).toBe(true)
    expect(isBookingTab('all')).toBe(false)
    expect(isBookingTab(undefined)).toBe(false)
  })

  it('counts down in Persian mm:ss under an hour and in hours beyond', () => {
    expect(formatCountdown('2026-10-16T08:39:05.000Z', NOW)).toBe('۰۹:۰۵ مانده')
    expect(formatCountdown('2026-10-16T11:30:00.000Z', NOW)).toBe(`${(3).toLocaleString('fa-IR')} ساعت مانده`)
    // Floored, with minutes: 1h30m must never read as «۲ ساعت».
    expect(formatCountdown('2026-10-16T10:00:00.000Z', NOW)).toBe('۱ ساعت و ۳۰ دقیقه مانده')
    expect(formatCountdown('2026-10-16T10:29:59.000Z', NOW)).toBe('۱ ساعت و ۵۹ دقیقه مانده')
    expect(formatCountdown('2026-10-16T08:00:00.000Z', NOW)).toBe('منقضی شده')
  })
})
