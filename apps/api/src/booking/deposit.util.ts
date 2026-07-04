export function calculateDeposit(priceToman: number, depositPercent: number, depositMinToman: number): number {
  const byPercent = Math.round((priceToman * depositPercent) / 100);
  return Math.max(byPercent, depositMinToman);
}
