import { describe, expect, it } from 'vitest'
import { contactPhoneError, CONTACT_PHONE_ERROR, normalizeContactPhone } from './contact-phone'

describe('normalizeContactPhone', () => {
  it('converts Persian and Arabic digits and strips spaces and dashes', () => {
    expect(normalizeContactPhone('۰۹۱۲ ۳۴۵-۶۷۸۹')).toBe('09123456789')
    expect(normalizeContactPhone('٠٢١-١١٢٢٣٣٤٤')).toBe('02111223344')
  })
  it('leaves an empty value empty (clears)', () => {
    expect(normalizeContactPhone('  ')).toBe('')
  })
})

describe('contactPhoneError', () => {
  it.each(['', '   ', '09123456789', '۰۹۱۲۳۴۵۶۷۸۹', '02112345678', '0511 234 5678', '041-35123456'])('accepts %j', (v) => {
    expect(contactPhoneError(v)).toBe('')
  })
  it.each(['0912345678', '091234567890', '12345678', '02112345', '09o23456789', '0912345678a', '00112345678', '09-12'])('rejects %j', (v) => {
    expect(contactPhoneError(v)).toBe(CONTACT_PHONE_ERROR)
  })
})
