import { applyDiscount } from './discount'
import { formatToman } from './format-toman'

export type PricingType = 'fixed' | 'from' | 'range' | 'quote'

export interface PricedService {
  pricingType: PricingType
  price: number | null
  priceMax: number | null
  discountPercent: number | null
}

/**
 * The one plain-text rendering of a service's REAL catalog price, preserving the pricing
 * model exactly: FIXED is the discounted price the customer would actually pay, FROM is an
 * honest floor («از …»), RANGE is the salon's own floor-to-ceiling, and QUOTE never invents
 * a number. Same wording ServicePriceTag.vue renders on the salon page. Callers must never
 * add several of these together into a "total" -- FROM/RANGE/QUOTE make any sum misleading.
 */
export function formatServicePrice(service: PricedService): string {
  switch (service.pricingType) {
    case 'fixed':
      return `${formatToman(applyDiscount(service.price!, service.discountPercent))} تومان`
    case 'from':
      return `از ${formatToman(service.price!)} تومان`
    case 'range':
      return `${formatToman(service.price!)} تا ${formatToman(service.priceMax!)} تومان`
    default:
      return 'قیمت توافقی'
  }
}
