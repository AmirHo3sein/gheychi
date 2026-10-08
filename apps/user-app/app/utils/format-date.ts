// Shared date/time display for the customer app. All instants render in Asia/Tehran on the
// Persian calendar via Intl; never `toLocaleString('fa-IR')`, whose default output is a long
// "۱۴۰۵/۷/۱۵، ۱۵:۰۰:۰۰" string with seconds that read as machine noise on a booking card.
const TZ = 'Asia/Tehran'

const dateFormat = new Intl.DateTimeFormat('fa-IR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TZ,
})
const weekdayDateFormat = new Intl.DateTimeFormat('fa-IR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TZ,
})
const timeFormat = new Intl.DateTimeFormat('fa-IR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: TZ,
})

// The field ORDER of a combined Intl pattern is locale-data dependent (and a bidi-mixed
// "۱۴۰۵ مهر ۱۵, چهارشنبه" has been observed), so the pieces are pulled out by type and
// assembled explicitly: weekday day month year.
function partsOf(format: Intl.DateTimeFormat, d: Date): Record<string, string> {
  return Object.fromEntries(format.formatToParts(d).map((p) => [p.type, p.value]))
}

function toDate(iso: string): Date | null {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** «چهارشنبه ۱۵ مهر ۱۴۰۵ · ساعت ۱۵:۰۰» -- an appointment's full human description. */
export function formatAppointment(iso: string): string {
  const d = toDate(iso)
  if (!d) return ''
  const p = partsOf(weekdayDateFormat, d)
  return `${p.weekday} ${p.day} ${p.month} ${p.year} · ساعت ${timeFormat.format(d)}`
}

/** «۱۵ مهر ۱۴۰۵» */
export function formatDateShort(iso: string): string {
  const d = toDate(iso)
  return d ? shortDate(d) : ''
}

function shortDate(d: Date): string {
  const p = partsOf(dateFormat, d)
  return `${p.day} ${p.month} ${p.year}`
}

/** «۱۵ مهر ۱۴۰۵ · ۱۵:۰۰» -- no seconds. */
export function formatDateTime(iso: string): string {
  const d = toDate(iso)
  return d ? `${shortDate(d)} · ${timeFormat.format(d)}` : ''
}
