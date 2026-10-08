import { toEnglishDigits } from './digits'

// Mirrors the API's contactPhone rule (Create/UpdateSalonDto): an Iranian mobile
// (09 + 9 digits) or a landline (0 + area code 1-8 + 9 more digits = area code + 8 digits).
const MOBILE_RE = /^09\d{9}$/
const LANDLINE_RE = /^0[1-8]\d{9}$/

export const CONTACT_PHONE_ERROR = 'شماره تماس معتبر نیست؛ موبایل (مثل ۰۹۱۲۳۴۵۶۷۸۹) یا تلفن ثابت با پیش‌شماره (مثل ۰۲۱۱۲۳۴۵۶۷۸) وارد کنید.'

// Persian/Arabic digits to ASCII, spaces and dashes stripped -- the same normalisation the
// server applies, so what the owner sees validated is what the API will store. '' clears.
export function normalizeContactPhone(raw: string): string {
  return toEnglishDigits(raw).replace(/[\s\-‐-―ـ]/g, '')
}

export function contactPhoneError(raw: string): string {
  const phone = normalizeContactPhone(raw)
  if (phone === '') return ''
  return MOBILE_RE.test(phone) || LANDLINE_RE.test(phone) ? '' : CONTACT_PHONE_ERROR
}
