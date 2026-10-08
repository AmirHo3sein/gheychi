import { formatToman } from './format-toman'

export interface BookingMoney {
  prepaidAmount?: number | null
  amountDue?: number | null
}

export interface MoneyLine {
  testid: 'prepaid' | 'amount-due'
  label: string
  amount: string
}

// Two-line summary from the API's own fields. Never derived from the deposit/price: a line
// appears only when the API reports money actually captured (prepaidAmount > 0) or a number
// still owed in the salon (amountDue is null for non-fixed pricing -> no line, not "0").
export function bookingMoneyLines(b: BookingMoney): MoneyLine[] {
  const lines: MoneyLine[] = []
  if (typeof b.prepaidAmount === 'number' && b.prepaidAmount > 0) {
    lines.push({ testid: 'prepaid', label: 'بیعانه دریافت‌شده', amount: formatToman(b.prepaidAmount) })
  }
  if (typeof b.amountDue === 'number') {
    lines.push({ testid: 'amount-due', label: 'مبلغ قابل دریافت در سالن', amount: formatToman(b.amountDue) })
  }
  return lines
}

export const COMPLETE_BLOCKED_REASON = 'بعد از زمان شروع نوبت قابل ثبت است'

// UX mirror of the API rule (completed only once now >= startsAt); the API stays the authority.
export function canMarkCompleted(startsAtIso: string, now: Date): boolean {
  return now.getTime() >= new Date(startsAtIso).getTime()
}
