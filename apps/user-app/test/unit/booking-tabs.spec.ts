import { describe, it, expect } from 'vitest'
import { isUpcomingBooking, parseBookingsTab, splitBookings } from '../../app/utils/booking-tabs'

const NOW = new Date('2026-10-16T10:00:00.000Z')

describe('isUpcomingBooking', () => {
  it('counts an active booking in the future as upcoming', () => {
    for (const status of ['pending_approval', 'pending_payment', 'confirmed']) {
      expect(isUpcomingBooking({ status, startsAt: '2026-10-17T10:00:00.000Z' }, NOW)).toBe(true)
    }
  })

  it('puts a finished, cancelled or expired booking in the past even if its time is ahead', () => {
    for (const status of ['completed', 'cancelled_by_user', 'cancelled_by_salon', 'cancelled_by_admin', 'rejected_by_salon', 'expired', 'no_show']) {
      expect(isUpcomingBooking({ status, startsAt: '2026-10-17T10:00:00.000Z' }, NOW)).toBe(false)
    }
  })

  it('treats a confirmed appointment whose time has passed as past', () => {
    expect(isUpcomingBooking({ status: 'confirmed', startsAt: '2026-10-15T10:00:00.000Z' }, NOW)).toBe(false)
  })
})

describe('splitBookings', () => {
  it('orders upcoming soonest-first and past most-recent-first', () => {
    const list = [
      { id: 'far', status: 'confirmed', startsAt: '2026-10-30T10:00:00.000Z' },
      { id: 'old', status: 'completed', startsAt: '2026-09-01T10:00:00.000Z' },
      { id: 'soon', status: 'pending_approval', startsAt: '2026-10-17T10:00:00.000Z' },
      { id: 'recent', status: 'cancelled_by_user', startsAt: '2026-10-10T10:00:00.000Z' },
    ]
    const { upcoming, past } = splitBookings(list, NOW)
    expect(upcoming.map((b) => b.id)).toEqual(['soon', 'far'])
    expect(past.map((b) => b.id)).toEqual(['recent', 'old'])
    expect(list[0]!.id).toBe('far')
  })
})

describe('parseBookingsTab', () => {
  it('accepts only the two tab names', () => {
    expect(parseBookingsTab('past')).toBe('past')
    expect(parseBookingsTab('upcoming')).toBe('upcoming')
    expect(parseBookingsTab('x')).toBeNull()
    expect(parseBookingsTab(undefined)).toBeNull()
  })
})
