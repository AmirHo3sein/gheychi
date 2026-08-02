export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

interface LabelMeta {
  label: string
  tone: Tone
}

const BOOKING_STATUS: Record<string, LabelMeta> = {
  pending_payment: { label: 'در انتظار پرداخت', tone: 'warning' },
  confirmed: { label: 'تایید شده', tone: 'info' },
  completed: { label: 'انجام شد', tone: 'success' },
  cancelled_by_user: { label: 'لغو شده (مشتری)', tone: 'neutral' },
  cancelled_by_salon: { label: 'لغو شده (آرایشگاه)', tone: 'neutral' },
  expired: { label: 'منقضی شده', tone: 'neutral' },
  no_show: { label: 'عدم حضور', tone: 'danger' },
}

export function bookingStatusLabel(status: string): LabelMeta {
  return BOOKING_STATUS[status] ?? { label: status, tone: 'neutral' }
}

const INVOICE_STATUS: Record<string, LabelMeta> = {
  issued: { label: 'صادرشده', tone: 'info' },
  partially_paid: { label: 'پرداخت جزئی', tone: 'warning' },
  paid: { label: 'پرداخت‌شده', tone: 'success' },
  void: { label: 'باطل‌شده', tone: 'neutral' },
}

export function invoiceStatusLabel(status: string): LabelMeta {
  return INVOICE_STATUS[status] ?? { label: status, tone: 'neutral' }
}

const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
]

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']

function toPersianDigits(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)])
}

export function jalaliMonthLabel(year: number, month: number): string {
  const name = JALALI_MONTHS[month - 1] ?? String(month)
  return `${name} ${toPersianDigits(year)}`
}
