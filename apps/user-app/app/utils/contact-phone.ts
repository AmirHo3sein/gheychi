import { toEnglishDigits, toPersianDigits } from './digits'

export interface ContactPhone {
  /** ASCII digits for the tel: href. */
  href: string
  /** Persian digits, grouped for reading. */
  display: string
}

// Salon contact numbers arrive as digits only (the API normalises and validates them):
// an 11-digit mobile (09xx xxx xxxx) or landline (0AA xxxx xxxx). Anything that doesn't fit is
// shown ungrouped rather than guessed at.
export function formatContactPhone(phone: string | null | undefined): ContactPhone | null {
  if (!phone) return null
  const digits = toEnglishDigits(phone).replace(/\D/g, '')
  if (!digits) return null
  let grouped = digits
  if (/^09\d{9}$/.test(digits)) {
    grouped = `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  } else if (/^0[1-8]\d{9}$/.test(digits)) {
    grouped = `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`
  }
  return { href: `tel:${digits}`, display: toPersianDigits(grouped) }
}
