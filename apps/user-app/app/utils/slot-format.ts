export interface DayAvailability {
  date: string
  slots: string[]
}

export function pickDefaultDate(days: DayAvailability[]): string | null {
  const firstWithSlots = days.find((d) => d.slots.length > 0)
  return firstWithSlots?.date ?? null
}

export function formatSlotTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tehran' }).format(
    new Date(iso),
  )
}

export function formatDateLabel(dateStr: string): string {
  return new Intl.DateTimeFormat('fa-IR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Tehran',
  }).format(
    new Date(`${dateStr}T12:00:00Z`), // noon UTC keeps this on the intended calendar day in Asia/Tehran regardless of DST edge cases
  )
}
