import { toPersianDigits } from './digits'

// Persian names for the entitlement keys the platform actually enforces; an unknown key (a plan
// can carry any admin-defined JSON key) falls back to the raw key so nothing is ever hidden.
const ENTITLEMENT_LABELS: Record<string, string> = {
  smsMonthlyQuota: 'سقف پیامک ماهانه',
}

export function entitlementLabel(key: string): string {
  return ENTITLEMENT_LABELS[key] ?? key
}

// One entitlement value for display: numbers/strings with Persian digits, booleans in words,
// anything structured as its JSON (still Persian digits) so an admin-defined shape stays visible.
export function formatEntitlementValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return value.toLocaleString('fa-IR')
  if (typeof value === 'boolean') return value ? 'بله' : 'خیر'
  if (typeof value === 'string') return toPersianDigits(value)
  return toPersianDigits(JSON.stringify(value))
}

// «label: value»، joined -- the resolved entitlements line on a salon's subscription card.
export function formatEntitlements(entitlements: Record<string, unknown>): string {
  const keys = Object.keys(entitlements)
  if (keys.length === 0) return 'بدون محدودیت'
  return keys.map((k) => `${entitlementLabel(k)}: ${formatEntitlementValue(entitlements[k])}`).join('، ')
}
