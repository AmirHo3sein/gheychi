import { describe, expect, it } from 'vitest'
import { entitlementLabel, formatEntitlementValue } from './entitlement-label'

describe('entitlementLabel', () => {
  it('translates the enforced SMS quota key', () => {
    expect(entitlementLabel('smsMonthlyQuota')).toBe('سقف پیامک ماهانه')
  })

  it('translates every key in the API entitlement registry', () => {
    expect(entitlementLabel('customHandle')).toBe('ویرایش نشانی اختصاصی')
    expect(entitlementLabel('qrCode')).toBe('کد QR')
    expect(entitlementLabel('crmCustomerCap')).toBe('سقف مشتریان CRM')
  })

  it('falls back to the raw key for anything unknown', () => {
    expect(entitlementLabel('someFutureKey')).toBe('someFutureKey')
  })
})

describe('formatEntitlementValue', () => {
  it('renders numbers with Persian digits and booleans in words', () => {
    expect(formatEntitlementValue(20)).toBe('۲۰')
    expect(formatEntitlementValue(true)).toBe('دارد')
    expect(formatEntitlementValue(false)).toBe('ندارد')
  })

  it('reads a null limit as unlimited', () => {
    expect(formatEntitlementValue(null)).toBe('نامحدود')
  })

  it('shows any other admin-defined shape verbatim', () => {
    expect(formatEntitlementValue('pro')).toBe('pro')
    expect(formatEntitlementValue({ a: 1 })).toBe('{"a":1}')
  })
})
