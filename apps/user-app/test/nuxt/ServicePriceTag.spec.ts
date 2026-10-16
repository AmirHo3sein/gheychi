import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ServicePriceTag from '../../app/components/salon/ServicePriceTag.vue'

// Wrapping STRUCTURE, not pixels (the test DOM has no layout): a RANGE price must be able to
// break onto two lines between its amounts so the full figure stays visible in a ~186px
// column at 320px, while each amount stays glued to its own «تا» / «تومان».
describe('ServicePriceTag', () => {
  it('renders a RANGE as two unbreakable units inside a wrapping container', async () => {
    const wrapper = await mountSuspended(ServicePriceTag, {
      props: { service: { pricingType: 'range', price: 100_000_000, priceMax: 1_000_000_000, discountPercent: null } },
    })

    const range = wrapper.get('[data-testid="price-range"]')
    expect(range.classes()).toContain('flex-wrap')
    // Never the old single nowrap line, which is what got clipped.
    expect(range.classes()).not.toContain('whitespace-nowrap')
    // No font shrinking as the "fix".
    expect(range.classes().some((c) => /^text-(xs|\[)/.test(c))).toBe(false)

    const parts = range.findAll('[data-testid="price-range-part"]')
    expect(parts).toHaveLength(2)
    for (const part of parts) expect(part.classes()).toContain('whitespace-nowrap')
    expect(parts[0]!.text()).toBe('۱۰۰٬۰۰۰٬۰۰۰ تا')
    expect(parts[1]!.text()).toBe('۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان')
    // Each amount is its own LTR, tabular-digit run.
    expect(parts.map((p) => p.get('[dir="ltr"]').classes())).toEqual([
      expect.arrayContaining(['tnum']),
      expect.arrayContaining(['tnum']),
    ])
    expect(range.text().replace(/\s+/g, ' ')).toBe('۱۰۰٬۰۰۰٬۰۰۰ تا ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان')
  })

  it('leaves FIXED, FROM and QUOTE as single unbreakable units', async () => {
    const fixed = await mountSuspended(ServicePriceTag, {
      props: { service: { pricingType: 'fixed', price: 500_000, priceMax: null, discountPercent: null } },
    })
    expect(fixed.find('[data-testid="price-range"]').exists()).toBe(false)
    expect(fixed.text()).toContain('تومان')

    const from = await mountSuspended(ServicePriceTag, {
      props: { service: { pricingType: 'from', price: 500_000, priceMax: null, discountPercent: null } },
    })
    expect(from.text()).toMatch(/^از .* تومان$/)

    const quote = await mountSuspended(ServicePriceTag, {
      props: { service: { pricingType: 'quote', price: null, priceMax: null, discountPercent: null } },
    })
    expect(quote.text()).toBe('قیمت توافقی')
  })
})
