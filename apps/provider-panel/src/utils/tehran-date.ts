// Every slot/booking instant is a real UTC instant (see the API's availability.util.ts),
// but "which calendar day is this" has to be answered in the salon's own timezone, not the
// viewing browser's -- a provider reviewing from another timezone must see the same day
// grouping their customers and the API's own schedule_exceptions.date comparisons use.
// en-CA is the one built-in Intl locale that formats as plain "YYYY-MM-DD", matching the
// Gregorian string JalaliDatePicker/schedule_exceptions already use everywhere else.
export function tehranDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(d)
}
