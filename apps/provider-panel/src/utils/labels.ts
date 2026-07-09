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
