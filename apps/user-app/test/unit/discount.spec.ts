import { describe, it, expect } from 'vitest'
import { applyDiscount } from '../../app/utils/discount'

describe('applyDiscount', () => {
  it('rounds price * (100 - discountPercent) / 100', () => {
    expect(applyDiscount(300_000, 20)).toBe(240_000)
    expect(applyDiscount(99_999, 10)).toBe(89_999) // round(89999.1) = 89999
  })

  it('leaves the price untouched for null/undefined/zero/negative discount', () => {
    expect(applyDiscount(300_000, null)).toBe(300_000)
    expect(applyDiscount(300_000, undefined)).toBe(300_000)
    expect(applyDiscount(300_000, 0)).toBe(300_000)
    expect(applyDiscount(300_000, -5)).toBe(300_000)
  })
})
