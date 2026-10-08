import { describe, expect, it } from 'vitest'
import { entitlementLabel } from './entitlement-label'

describe('entitlementLabel', () => {
  it('translates the enforced SMS quota key', () => {
    expect(entitlementLabel('smsMonthlyQuota')).toBe('سقف پیامک ماهانه')
  })

  it('falls back to the raw key for anything unknown', () => {
    expect(entitlementLabel('crmCustomerCap')).toBe('crmCustomerCap')
  })
})
