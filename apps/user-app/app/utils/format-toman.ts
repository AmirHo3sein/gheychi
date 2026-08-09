// Toman amounts use Latin digits with comma grouping ("3,000,000"), not the Persian-digit
// fa-IR grouping ("۳٬۰۰۰٬۰۰۰") this app uses for every other number -- a deliberate exception
// for money specifically, so large prices stay quick to scan digit-by-digit. Every other
// numeric display (ratings, counts, durations, percents) keeps using toLocaleString('fa-IR')
// directly and should NOT be routed through this function.
export function formatToman(amount: number): string {
  return amount.toLocaleString('en-US')
}
