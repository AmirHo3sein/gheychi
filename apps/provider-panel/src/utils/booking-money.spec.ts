import { describe, expect, it } from 'vitest'
import { bookingMoneyLines, canMarkCompleted } from './booking-money'

describe('bookingMoneyLines', () => {
  it('shows both lines when a deposit was captured and an amount remains', () => {
    const lines = bookingMoneyLines({ prepaidAmount: 50000, amountDue: 150000 })
    expect(lines.map((l) => l.label)).toEqual(['بیعانه دریافت‌شده', 'مبلغ قابل دریافت در سالن'])
    expect(lines[0]!.amount).toBe((50000).toLocaleString('fa-IR'))
  })
  it('omits the prepaid line when nothing was captured', () => {
    expect(bookingMoneyLines({ prepaidAmount: 0, amountDue: 200000 }).map((l) => l.testid)).toEqual(['amount-due'])
  })
  it('shows a zero amount due (fully prepaid) but omits it for non-fixed pricing (null)', () => {
    expect(bookingMoneyLines({ prepaidAmount: 10, amountDue: 0 }).map((l) => l.testid)).toEqual(['prepaid', 'amount-due'])
    expect(bookingMoneyLines({ prepaidAmount: 0, amountDue: null })).toEqual([])
  })
  it('shows nothing for a response without the new fields', () => {
    expect(bookingMoneyLines({})).toEqual([])
  })
})

describe('canMarkCompleted', () => {
  it('is false before and true at/after the start time', () => {
    const start = '2026-10-08T10:00:00.000Z'
    expect(canMarkCompleted(start, new Date('2026-10-08T09:59:59.000Z'))).toBe(false)
    expect(canMarkCompleted(start, new Date('2026-10-08T10:00:00.000Z'))).toBe(true)
  })
})
