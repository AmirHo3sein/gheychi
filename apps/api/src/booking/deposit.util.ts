// apps/user-app/app/pages/booking/[slug]/[serviceId].vue duplicates this formula in its
// `estimatedDeposit` computed for a pre-submit display estimate (this function remains
// the sole authority -- it's what actually runs at booking creation). Keep both in sync
// if this changes (e.g. per-salon overrides, promotional discounts, tax).
export function calculateDeposit(priceToman: number, depositPercent: number, depositMinToman: number): number {
  const byPercent = Math.round((priceToman * depositPercent) / 100);
  // The minimum is a floor on a NORMAL price, never a licence to charge more than the
  // service itself costs. The deposit is a PREPAYMENT -- a completed booking's deposit is
  // deducted from the in-salon total -- so the price it is deducted from is a hard
  // ceiling. Without this cap, the live config (20% / 200,000 toman) charged every service
  // under 1,000,000 toman more than the advertised 20%, and any final price under 200,000
  // toman -- reachable legitimately via a 100%-off coupon, or a fixed-amount referral
  // coupon worth at least the price -- was charged MORE THAN THE BOOKING COSTS, with no
  // recovery path (the overpayment is settled in-salon, outside this system).
  //
  // A zero price therefore yields a zero deposit: nothing to collect. BookingsService
  // .createHold treats that as "no payment session at all" and confirms the booking
  // outright rather than sending the customer to a gateway for 0 toman.
  return Math.max(0, Math.min(Math.max(byPercent, depositMinToman), priceToman));
}
