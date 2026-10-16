import { formatNumber } from '@/utils/digits'

// Persian names for the entitlement keys the platform actually enforces; an unknown key (a plan
// can carry any admin-defined JSON key) falls back to the raw key so nothing is ever hidden.
const ENTITLEMENT_LABELS: Record<string, string> = {
  // Mirrors the labels in apps/api/src/subscriptions/entitlement-keys.ts (the registry).
  smsMonthlyQuota: 'سقف پیامک ماهانه',
  customHandle: 'ویرایش نشانی اختصاصی',
  qrCode: 'کد QR',
  crmCustomerCap: 'سقف مشتریان CRM',
}

export function entitlementLabel(key: string): string {
  return ENTITLEMENT_LABELS[key] ?? key
}

// An entitlement value is admin-defined JSON. Numbers and booleans -- the shapes every enforced
// key uses -- read in Persian; anything else is shown verbatim (JSON) rather than hidden.
export function formatEntitlementValue(value: unknown): string {
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'boolean') return value ? 'دارد' : 'ندارد'
  if (typeof value === 'string') return value
  // The registry's `limit` keys (crmCustomerCap) use null for "no ceiling".
  if (value === null) return 'نامحدود'
  return JSON.stringify(value)
}
