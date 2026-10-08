import { describe, it, expect } from 'vitest'
import { formatMemberSince } from '../../app/utils/member-since'

describe('formatMemberSince', () => {
  it('renders the Persian month and year in Tehran time', () => {
    expect(formatMemberSince('2026-10-08T10:00:00.000Z')).toBe('عضو قیچی از مهر ۱۴۰۵')
  })

  it('uses Tehran time at the month boundary (late UTC on 22 Sep is already 1 Mehr)', () => {
    // 1405-07-01 00:00 Tehran (UTC+3:30) == 2026-09-22T20:30:00Z
    expect(formatMemberSince('2026-09-22T20:30:00.000Z')).toBe('عضو قیچی از مهر ۱۴۰۵')
    expect(formatMemberSince('2026-09-22T20:29:00.000Z')).toBe('عضو قیچی از شهریور ۱۴۰۵')
  })

  it('renders nothing when absent or unparseable', () => {
    expect(formatMemberSince(null)).toBeNull()
    expect(formatMemberSince(undefined)).toBeNull()
    expect(formatMemberSince('')).toBeNull()
    expect(formatMemberSince('not a date')).toBeNull()
  })
})
