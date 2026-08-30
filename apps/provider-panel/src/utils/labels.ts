export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

interface LabelMeta {
  label: string
  tone: Tone
}

const BOOKING_STATUS: Record<string, LabelMeta> = {
  // Manual-approval mode only: the customer has asked for the slot and is waiting on the
  // owner's decision. Nothing is paid yet -- deliberately not "در انتظار پرداخت".
  pending_approval: { label: 'در انتظار تایید شما', tone: 'warning' },
  pending_payment: { label: 'در انتظار پرداخت', tone: 'warning' },
  confirmed: { label: 'تایید شده', tone: 'info' },
  completed: { label: 'انجام شد', tone: 'success' },
  cancelled_by_user: { label: 'لغو شده (مشتری)', tone: 'neutral' },
  cancelled_by_salon: { label: 'لغو شده (آرایشگاه)', tone: 'neutral' },
  // Distinct from cancelled_by_salon: the salon declined the REQUEST before it was ever
  // confirmed (and before any payment), rather than cancelling a live booking.
  rejected_by_salon: { label: 'رد شده توسط شما', tone: 'danger' },
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

const CUSTOMER_SEGMENT: Record<string, LabelMeta> = {
  new: { label: 'مشتری جدید', tone: 'info' },
  returning: { label: 'مشتری وفادار', tone: 'success' },
  lapsed: { label: 'مدتی است نیامده', tone: 'warning' },
}

export function customerSegmentLabel(segment: string): LabelMeta {
  return CUSTOMER_SEGMENT[segment] ?? { label: segment, tone: 'neutral' }
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
