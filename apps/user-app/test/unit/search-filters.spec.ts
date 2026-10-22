import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, activeFilterCount, filterQuery, priceBandLabel } from '../../app/utils/search-filters'

describe('search filters', () => {
  it('counts only what differs from the defaults', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0)
    expect(activeFilterCount({ ...DEFAULT_FILTERS, radiusKm: 5 })).toBe(1)
    expect(activeFilterCount({ radiusKm: 5, priceMin: null, priceMax: 10, includeQuote: false })).toBe(2)
    expect(activeFilterCount({ ...DEFAULT_FILTERS, includeQuote: true })).toBe(1)
  })

  it('sends only non-default values to /search (a 0 minimum is still a real bound)', () => {
    expect(filterQuery(DEFAULT_FILTERS)).toEqual({ radiusKm: undefined, priceMin: undefined, priceMax: undefined, includeQuote: undefined })
    expect(filterQuery({ radiusKm: 50, priceMin: 0, priceMax: null, includeQuote: true })).toEqual({ radiusKm: 50, priceMin: 0, priceMax: undefined, includeQuote: true })
  })

  it('labels the band honestly for each side', () => {
    expect(priceBandLabel(null, null)).toBeNull()
    expect(priceBandLabel(1000, null)).toBe('از ۱٬۰۰۰ تومان')
    expect(priceBandLabel(null, 2000)).toBe('تا ۲٬۰۰۰ تومان')
    expect(priceBandLabel(1000, 2000)).toBe('۱٬۰۰۰ تا ۲٬۰۰۰ تومان')
  })
})
