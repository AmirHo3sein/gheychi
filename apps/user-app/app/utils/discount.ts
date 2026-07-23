// Client-side mirror of apps/api/src/booking/discount.util.ts's applyDiscount, used only
// for a display-only price preview before any coupon has been applied. The API remains the
// sole source of truth: POST /coupons/validate and POST /bookings both return an
// authoritative discounted price/deposit that supersedes this client-side estimate once
// available. Keep in sync with that file if the discount formula ever changes.
export function applyDiscount(price: number, discountPercent: number | null | undefined): number {
  if (!discountPercent || discountPercent <= 0) return price
  return Math.round((price * (100 - discountPercent)) / 100)
}
