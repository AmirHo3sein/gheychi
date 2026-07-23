// Discounts never stack/multiply -- if both a per-service discount and a coupon
// apply to the same booking, the LARGER single percentage wins and the other is
// simply ignored. This function is the sole authority for that resolution; both
// BookingsService.createHold (the real, money-moving path) and
// CouponValidationController (the read-only preview) call it so the two can never
// disagree about which discount would apply.
export function resolveDiscountPercent(
  serviceDiscountPercent: number | null,
  couponDiscountPercent: number | null,
): number {
  return Math.max(serviceDiscountPercent ?? 0, couponDiscountPercent ?? 0);
}

// Applies a resolved discount percent to a price. A discountPercent of 0 (or
// negative, defensively) leaves the price untouched rather than rounding it --
// avoids a no-op Math.round from ever nudging a price by a stray toman.
export function applyDiscount(price: number, discountPercent: number): number {
  if (discountPercent <= 0) return price;
  return Math.round((price * (100 - discountPercent)) / 100);
}

// Discount candidate for resolveBestPrice: 'percent' mirrors applyDiscount's own
// rounding exactly (Math.round(price * (100 - value) / 100)); 'fixed' is a flat
// toman amount off the price, clamped at 0 (a coupon worth more than the price
// itself never produces a negative price). `null` candidates (no discount from that
// source) are skipped, not treated as a free/zero-cost discount.
export type DiscountCandidate = { kind: 'percent' | 'fixed'; value: number } | null;

// Slice 6 (spec section 3): percent and fixed-toman discounts aren't directly
// comparable as raw numbers, so "which one wins" has to compare the RESULTING price
// each would produce, not the input values. This is the sole authority for that
// comparison across kinds -- same role resolveDiscountPercent plays for the
// percent-vs-percent case, which it remains (untouched) for backward compatibility
// and because it's simpler for that narrower case.
//
// Never returns a price worse than the original: `best` starts at `price` itself, so
// a candidate that would somehow increase the price (not possible with normal
// percent/fixed inputs, but defensively) is simply never selected over "no discount".
export function resolveBestPrice(price: number, candidates: DiscountCandidate[]): number {
  return resolveBestPriceWithWinner(price, candidates).finalPrice;
}

export interface ResolvedDiscount {
  finalPrice: number;
  // The single candidate that actually produced finalPrice, or null if none of the
  // candidates beat "no discount" at all. On a tie between two candidates producing
  // the identical resulting price, the one appearing EARLIER in `candidates` wins --
  // matches resolveBestPrice's own `<` (strictly-less-than) comparison, which only
  // ever overwrites `best` on a strict improvement.
  winner: DiscountCandidate;
}

// Callers that need to know not just the resulting price but WHICH mechanism
// produced it (BookingsService.createHold, to decide whether to record the win on
// bookings.discount_percent or bookings.discount_fixed_amount; the coupon preview
// endpoint, to decide whether to populate the legacy appliedDiscountPercent field)
// use this instead of plain resolveBestPrice. Implemented once here so the two never
// disagree with each other or with resolveBestPrice about which price wins --
// resolveBestPrice above is a thin wrapper over this, not a separate calculation.
export function resolveBestPriceWithWinner(price: number, candidates: DiscountCandidate[]): ResolvedDiscount {
  let best = price;
  let winner: DiscountCandidate = null;
  for (const c of candidates) {
    if (!c) continue;
    const candidatePrice = c.kind === 'percent' ? Math.round((price * (100 - c.value)) / 100) : Math.max(0, price - c.value);
    if (candidatePrice < best) {
      best = candidatePrice;
      winner = c;
    }
  }
  return { finalPrice: best, winner };
}
