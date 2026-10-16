import { describe, expect, it } from 'vitest'
import { formatNumber, formatPercent, toEnglishDigits, toPersianDigits } from './digits'

describe('digits', () => {
  it('round-trips Persian and ASCII digits', () => {
    expect(toEnglishDigits('۰۹۱۲')).toBe('0912')
    expect(toEnglishDigits('٠٩')).toBe('09')
    expect(toPersianDigits('12:30')).toBe('۱۲:۳۰')
    expect(toPersianDigits(19)).toBe('۱۹')
  })

  it('formats a visible number with Persian digits and grouping', () => {
    expect(formatNumber(20)).toBe('۲۰')
    expect(formatNumber(12345)).toBe((12345).toLocaleString('fa-IR'))
    expect(formatNumber(Number.NaN)).toBe('—')
  })

  it('formats a percent with Persian digits', () => {
    expect(formatPercent(10)).toBe('۱۰٪')
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('—')
  })
})
