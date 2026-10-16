import { describe, it, expect } from 'vitest'
import { buildIcs, escapeIcsText, foldIcsLine, toIcsUtc } from '../../app/utils/ics'

const encoder = new TextEncoder()

describe('toIcsUtc', () => {
  it('writes an absolute instant as basic-format UTC', () => {
    expect(toIcsUtc('2026-10-20T11:30:00.000Z')).toBe('20261020T113000Z')
  })

  it('converts a Tehran-offset instant to the correct UTC wall time (+03:30)', () => {
    // 15:00 in Tehran is 11:30 UTC -- the shift a naive "local time" export gets wrong.
    expect(toIcsUtc('2026-10-20T15:00:00+03:30')).toBe('20261020T113000Z')
  })

  it('refuses an unparseable date rather than writing garbage', () => {
    expect(() => toIcsUtc('not a date')).toThrow(RangeError)
  })
})

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeIcsText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne')
  })
})

describe('foldIcsLine', () => {
  it('leaves a short line alone', () => {
    expect(foldIcsLine('SUMMARY:کوتاهی مو')).toBe('SUMMARY:کوتاهی مو')
  })

  it('folds by octets, never splitting a multi-byte Persian letter', () => {
    const line = `SUMMARY:${'سالن زیبایی '.repeat(12)}`
    const folded = foldIcsLine(line)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    for (const [i, part] of parts.entries()) {
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75)
      if (i > 0) expect(part.startsWith(' ')).toBe(true)
    }
    // Unfolding (drop CRLF + one space) restores the original exactly.
    expect(folded.replace(/\r\n /g, '')).toBe(line)
  })
})

describe('buildIcs', () => {
  const ics = buildIcs({
    uid: 'b1@gheychi',
    title: 'کوتاهی مو — سالن نمونه',
    start: '2026-10-20T11:30:00.000Z',
    end: '2026-10-20T12:15:00.000Z',
    location: 'تهران، خیابان ولیعصر',
    description: 'نوبت شما در قیچی',
    url: 'https://gheychi.co/bookings/b1',
    alarmMinutesBefore: 60,
    now: new Date('2026-10-16T08:00:00.000Z'),
  })
  const unfolded = ics.replace(/\r\n /g, '')

  it('is a CRLF-delimited VCALENDAR with one VEVENT', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('carries the booking times in UTC and a deterministic DTSTAMP', () => {
    expect(unfolded).toContain('DTSTART:20261020T113000Z')
    expect(unfolded).toContain('DTEND:20261020T121500Z')
    expect(unfolded).toContain('DTSTAMP:20261016T080000Z')
    expect(unfolded).toContain('X-WR-TIMEZONE:Asia/Tehran')
  })

  it('escapes text fields and keeps the URL raw', () => {
    expect(unfolded).toContain('LOCATION:تهران، خیابان ولیعصر')
    expect(unfolded).toContain('UID:b1@gheychi')
    expect(unfolded).toContain('URL:https://gheychi.co/bookings/b1')
  })

  it('adds a reminder alarm when asked', () => {
    expect(unfolded).toContain('BEGIN:VALARM')
    expect(unfolded).toContain('TRIGGER:-PT60M')
  })

  it('omits optional fields that are absent', () => {
    const bare = buildIcs({ uid: 'x', title: 't', start: '2026-10-20T11:30:00Z', end: '2026-10-20T12:00:00Z', now: new Date(0) })
    expect(bare).not.toContain('LOCATION:')
    expect(bare).not.toContain('VALARM')
    expect(bare).not.toContain('URL:')
  })
})
