// Persian names for the entitlement keys the platform actually enforces; an unknown key (a plan
// can carry any admin-defined JSON key) falls back to the raw key so nothing is ever hidden.
const ENTITLEMENT_LABELS: Record<string, string> = {
  smsMonthlyQuota: 'سقف پیامک ماهانه',
}

export function entitlementLabel(key: string): string {
  return ENTITLEMENT_LABELS[key] ?? key
}
