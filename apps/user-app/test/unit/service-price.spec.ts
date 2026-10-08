import { describe, it, expect } from 'vitest'
import { formatServicePrice } from '../../app/utils/service-price'

describe('formatServicePrice', () => {
  it('FIXED shows the discounted price actually charged', () => {
    expect(formatServicePrice({ pricingType: 'fixed', price: 2_500_000, priceMax: null, discountPercent: null })).toBe('۲٬۵۰۰٬۰۰۰ تومان')
    expect(formatServicePrice({ pricingType: 'fixed', price: 1_000_000, priceMax: null, discountPercent: 10 })).toBe('۹۰۰٬۰۰۰ تومان')
  })

  it('FROM is an honest floor', () => {
    expect(formatServicePrice({ pricingType: 'from', price: 2_000_000, priceMax: null, discountPercent: null })).toBe('از ۲٬۰۰۰٬۰۰۰ تومان')
  })

  it('RANGE shows the salon’s own floor and ceiling', () => {
    expect(formatServicePrice({ pricingType: 'range', price: 2_000_000, priceMax: 3_500_000, discountPercent: null })).toBe(
      '۲٬۰۰۰٬۰۰۰ تا ۳٬۵۰۰٬۰۰۰ تومان',
    )
  })

  it('QUOTE never invents a number', () => {
    const text = formatServicePrice({ pricingType: 'quote', price: null, priceMax: null, discountPercent: null })
    expect(text).toBe('قیمت توافقی')
    expect(text).not.toMatch(/[0-9۰-۹]/)
  })
})
