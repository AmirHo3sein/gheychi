// A single-event iCalendar (.ics, RFC 5545) file for «افزودن به تقویم» on the booking detail
// page. Built entirely client-side from the booking the page already has -- no server round
// trip and nothing about the booking leaves the device until the customer saves the file.
//
// Times are written in UTC ("...Z"), not as Asia/Tehran local times with a VTIMEZONE block:
// startsAt/endsAt arrive from the API as absolute ISO instants, so UTC is exact by
// construction and every calendar app renders it in the viewer's own zone (Tehran for a
// customer in Iran). A floating/local time would need a VTIMEZONE definition to be correct,
// and getting Iran's historical DST rules wrong there is the classic way an .ics shifts an
// appointment by an hour. X-WR-TIMEZONE is only a display hint for apps that honour it.

export interface IcsEvent {
  /** Stable per booking, so re-importing the same file updates rather than duplicates. */
  uid: string
  title: string
  /** ISO instants. */
  start: string
  end: string
  location?: string | null
  description?: string | null
  url?: string | null
  /** Minutes before the start for a reminder; omitted/0 = no reminder. */
  alarmMinutesBefore?: number
  /** DTSTAMP -- injectable so tests are deterministic. */
  now?: Date
}

const CRLF = '\r\n'

/** 2026-10-20T11:30:00.000Z -> 20261020T113000Z */
export function toIcsUtc(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid date for .ics: ${String(value)}`)
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma and newlines. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

const encoder = new TextEncoder()

/**
 * RFC 5545 §3.1: content lines SHOULD be folded at 75 octets -- octets, not characters, and
 * Persian text is 2 bytes per letter in UTF-8. Folds only between whole characters so a
 * multi-byte letter is never split across two lines; continuation lines start with a space
 * (which counts toward their own 75).
 */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let current = ''
  let currentBytes = 0
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length
    const limit = parts.length === 0 ? 75 : 74
    if (currentBytes + chBytes > limit) {
      parts.push(current)
      current = ''
      currentBytes = 0
    }
    current += ch
    currentBytes += chBytes
  }
  parts.push(current)
  return parts.join(`${CRLF} `)
}

export function buildIcs(event: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gheychi//Booking//FA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-TIMEZONE:Asia/Tehran',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${toIcsUtc(event.now ?? new Date())}`,
    `DTSTART:${toIcsUtc(event.start)}`,
    `DTEND:${toIcsUtc(event.end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ]
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`)
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
  // URI values are not TEXT, so they are not backslash-escaped.
  if (event.url) lines.push(`URL:${event.url}`)
  if (event.alarmMinutesBefore && event.alarmMinutesBefore > 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(event.title)}`,
      `TRIGGER:-PT${Math.round(event.alarmMinutesBefore)}M`,
      'END:VALARM',
    )
  }
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map(foldIcsLine).join(CRLF) + CRLF
}

/** Triggers a browser download of the .ics text. Client-only. */
export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoked on the next tick: some browsers start the download asynchronously after click().
  setTimeout(() => URL.revokeObjectURL(href), 0)
}
