import { describe, it, expect } from 'vitest'
import { formatContactPhone } from '../../app/utils/contact-phone'

describe('formatContactPhone', () => {
  it('groups a mobile number, Persian digits on screen and ASCII in the tel: href', () => {
    expect(formatContactPhone('09123456789')).toEqual({ href: 'tel:09123456789', display: '۰۹۱۲ ۳۴۵ ۶۷۸۹' })
  })

  it('groups a landline as area code + 4 + 4', () => {
    expect(formatContactPhone('02112345678')).toEqual({ href: 'tel:02112345678', display: '۰۲۱ ۱۲۳۴ ۵۶۷۸' })
  })

  it('normalises Persian input digits to an ASCII href', () => {
    expect(formatContactPhone('۰۹۱۲۳۴۵۶۷۸۹')?.href).toBe('tel:09123456789')
  })

  it('shows an unrecognised shape ungrouped rather than guessing', () => {
    expect(formatContactPhone('12345')).toEqual({ href: 'tel:12345', display: '۱۲۳۴۵' })
  })

  it('returns null for null, undefined and empty values', () => {
    expect(formatContactPhone(null)).toBeNull()
    expect(formatContactPhone(undefined)).toBeNull()
    expect(formatContactPhone('')).toBeNull()
    expect(formatContactPhone('abc')).toBeNull()
  })
})
