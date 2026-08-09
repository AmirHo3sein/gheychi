// Farsi-digit, fa-IR-grouped ("۳٬۰۰۰٬۰۰۰"), matching every other numeric display in this app
// (ratings, counts, durations, percents). Money used to be a deliberate Latin-digit exception
// here -- reverted per explicit request that every number on the platform read as Farsi.
export function formatToman(amount: number): string {
  return amount.toLocaleString('fa-IR')
}
