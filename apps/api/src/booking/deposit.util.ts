// apps/user-app/app/pages/booking/[slug]/[serviceId].vue duplicates this formula in its
// `estimatedDeposit` computed for a pre-submit display estimate (this function remains
// the sole authority -- it's what actually runs at booking creation). Keep both in sync
// if this changes (e.g. per-salon overrides, promotional discounts, tax).
export function calculateDeposit(priceToman: number, depositPercent: number, depositMinToman: number): number {
  const byPercent = Math.round((priceToman * depositPercent) / 100);
  return Math.max(byPercent, depositMinToman);
}
