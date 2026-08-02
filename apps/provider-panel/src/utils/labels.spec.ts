import { describe, expect, it } from 'vitest'
import { bookingStatusLabel, invoiceStatusLabel, jalaliMonthLabel } from './labels'

describe('bookingStatusLabel', () => {
  it('falls back to the raw value for an unknown status', () => {
    expect(bookingStatusLabel('weird')).toEqual({ label: 'weird', tone: 'neutral' })
  })
})

describe('invoiceStatusLabel', () => {
  it('maps every invoice status to a Farsi label and tone', () => {
    expect(invoiceStatusLabel('issued')).toEqual({ label: 'صادرشده', tone: 'info' })
    expect(invoiceStatusLabel('partially_paid')).toEqual({ label: 'پرداخت جزئی', tone: 'warning' })
    expect(invoiceStatusLabel('paid')).toEqual({ label: 'پرداخت‌شده', tone: 'success' })
    expect(invoiceStatusLabel('void')).toEqual({ label: 'باطل‌شده', tone: 'neutral' })
  })

  it('falls back to the raw value for an unknown status', () => {
    expect(invoiceStatusLabel('weird')).toEqual({ label: 'weird', tone: 'neutral' })
  })
})

describe('jalaliMonthLabel', () => {
  it('formats a Jalali (year, month) pair with Persian digits and the Persian month name', () => {
    expect(jalaliMonthLabel(1403, 1)).toBe('فروردین ۱۴۰۳')
    expect(jalaliMonthLabel(1403, 12)).toBe('اسفند ۱۴۰۳')
  })

  it('does not insert a thousands separator into the year', () => {
    expect(jalaliMonthLabel(1403, 7)).not.toContain('٬')
  })
})
