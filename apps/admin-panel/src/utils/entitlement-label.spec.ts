import { describe, expect, it } from 'vitest'
import { entitlementLabel, formatEntitlementValue, formatEntitlements } from './entitlement-label'

describe('entitlementLabel', () => {
  it('translates the enforced SMS quota key', () => {
    expect(entitlementLabel('smsMonthlyQuota')).toBe('سقف پیامک ماهانه')
  })

  it('falls back to the raw key for anything unknown', () => {
    expect(entitlementLabel('crmCustomerCap')).toBe('crmCustomerCap')
  })
})

describe('formatEntitlements', () => {
  it('renders label: value with Persian digits', () => {
    expect(formatEntitlements({ smsMonthlyQuota: 20 })).toBe('سقف پیامک ماهانه: ۲۰')
    expect(formatEntitlements({ smsMonthlyQuota: 1500, crmCustomerCap: '30' })).toBe('سقف پیامک ماهانه: ۱٬۵۰۰، crmCustomerCap: ۳۰')
  })

  it('renders booleans in words and structured values as Persian-digit JSON', () => {
    expect(formatEntitlementValue(true)).toBe('بله')
    expect(formatEntitlementValue(false)).toBe('خیر')
    expect(formatEntitlementValue({ max: 5 })).toBe('{"max":۵}')
    expect(formatEntitlementValue(null)).toBe('—')
  })

  it('says unlimited when nothing is set', () => {
    expect(formatEntitlements({})).toBe('بدون محدودیت')
  })
})
