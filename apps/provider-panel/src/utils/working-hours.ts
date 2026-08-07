// Weekday 0 = یکشنبه, matching the API's `working_hours.weekday` numbering (JS Date.getDay()
// convention) -- a lookup table by stored int, NOT a display/render order. Never reorder this
// array itself (every WEEKDAY_LABELS[w] lookup across the app assumes this exact indexing).
export const WEEKDAY_LABELS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']

// Iran's week starts Saturday, not Sunday -- this is the separate, display-only ordering
// (a list of weekday ints in the order they should be RENDERED), kept apart from
// WEEKDAY_LABELS so the stored 0=Sunday numbering (and everything keyed off it: the
// `working_hours.weekday` column, booking/availability logic) never has to change.
export const WEEKDAY_DISPLAY_ORDER = [6, 0, 1, 2, 3, 4, 5]

export interface WorkingHourRow {
  weekday: number
  openTime: string
  closeTime: string
  enabled: boolean
}

export interface HoursValidation {
  /** Empty when every enabled day is valid. */
  message: string
  /** Weekdays to mark on the schedule editor. */
  invalid: number[]
}

// Shared by the Hours screen and the onboarding wizard's schedule step, which have to agree
// exactly with the API: PUT /salons/mine/hours 400s on any openTime >= closeTime
// (schedule.controller.ts `replaceHours`). In the wizard that 400 arrives *after*
// POST /salons has already created the salon, so catching it client-side is the only thing
// keeping an owner out of a half-created salon.
// HH:MM strings sort lexicographically the same way they sort chronologically, so a plain
// string compare is enough here -- no parsing.
export function validateWorkingHours(hours: WorkingHourRow[]): HoursValidation {
  const invalid = hours.filter((h) => h.enabled && h.closeTime <= h.openTime).map((h) => h.weekday)
  if (invalid.length === 0) return { message: '', invalid: [] }
  const names = invalid.map((w) => WEEKDAY_LABELS[w]).join('، ')
  return {
    // Spells out the overnight case: a barbershop open 20:00–02:00 is a legitimate
    // business but not a range this API can store, so "just fix the typo" advice alone
    // would read as a bug to that owner.
    message: `ساعت پایان باید بعد از ساعت شروع باشد (بازه شبانه مثل ۲۰:۰۰ تا ۰۲:۰۰ پشتیبانی نمی‌شود): ${names}`,
    invalid,
  }
}
