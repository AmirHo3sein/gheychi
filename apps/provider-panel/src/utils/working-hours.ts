// Weekday 0 = یکشنبه, matching the API's `working_hours.weekday` numbering (JS Date.getDay()
// convention) -- a lookup table by stored int, NOT a display/render order. Never reorder this
// array itself (every WEEKDAY_LABELS[w] lookup across the app assumes this exact indexing).
export const WEEKDAY_LABELS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']

// Iran's week starts Saturday, not Sunday -- this is the separate, display-only ordering
// (a list of weekday ints in the order they should be RENDERED), kept apart from
// WEEKDAY_LABELS so the stored 0=Sunday numbering (and everything keyed off it: the
// `working_hours.weekday` column, booking/availability logic) never has to change.
export const WEEKDAY_DISPLAY_ORDER = [6, 0, 1, 2, 3, 4, 5]

export interface TimeRange {
  openTime: string
  closeTime: string
}

// A weekday can carry more than one range (e.g. 09:00-13:00 and 14:00-20:00 around a lunch
// break) -- the API has supported this since day one (working_hours.weekday has no unique
// constraint of its own, only (salon_id, weekday, open_time)), this is just the provider-panel
// UI catching up to it. `ranges` is never empty while `enabled` is true; a freshly-enabled day
// starts with exactly one default range, same as before this type gained the array.
export interface WorkingHourRow {
  weekday: number
  enabled: boolean
  ranges: TimeRange[]
}

export interface HoursValidation {
  /** Empty when every enabled day is valid. */
  message: string
  /** Weekdays to mark on the schedule editor. */
  invalid: number[]
}

// Two ranges overlap (touching at a shared boundary does NOT count -- 09:00-12:00 followed by
// 12:00-17:00 is a valid back-to-back schedule) exactly when `a.open < b.close && b.open <
// a.close`. HH:MM strings sort lexicographically the same way they sort chronologically, so a
// plain string compare is enough -- no parsing. Ported from the API's own
// findOverlappingHourRanges (schedule-hours.util.ts) so a bad split shift is caught here,
// client-side, instead of only by the server's 400.
function hasOverlap(ranges: TimeRange[]): boolean {
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i]!
      const b = ranges[j]!
      if (a.openTime < b.closeTime && b.openTime < a.closeTime) return true
    }
  }
  return false
}

// Shared by the Hours screen and the onboarding wizard's schedule step, which have to agree
// exactly with the API: PUT /salons/mine/hours 400s on any openTime >= closeTime, or on any
// two ranges overlapping on the same weekday (schedule.controller.ts `replaceHours`). In the
// wizard that 400 arrives *after* POST /salons has already created the salon, so catching it
// client-side is the only thing keeping an owner out of a half-created salon.
export function validateWorkingHours(hours: WorkingHourRow[]): HoursValidation {
  const invertedWeekdays = hours
    .filter((h) => h.enabled && h.ranges.some((r) => r.closeTime <= r.openTime))
    .map((h) => h.weekday)
  if (invertedWeekdays.length > 0) {
    const names = invertedWeekdays.map((w) => WEEKDAY_LABELS[w]).join('، ')
    return {
      // Spells out the overnight case: a barbershop open 20:00-02:00 is a legitimate
      // business but not a range this API can store, so "just fix the typo" advice alone
      // would read as a bug to that owner.
      message: `ساعت پایان باید بعد از ساعت شروع باشد (بازه شبانه مثل ۲۰:۰۰ تا ۰۲:۰۰ پشتیبانی نمی‌شود): ${names}`,
      invalid: invertedWeekdays,
    }
  }

  const overlappingWeekdays = hours.filter((h) => h.enabled && hasOverlap(h.ranges)).map((h) => h.weekday)
  if (overlappingWeekdays.length > 0) {
    const names = overlappingWeekdays.map((w) => WEEKDAY_LABELS[w]).join('، ')
    return {
      message: `بازه‌های ساعت کاری یک روز نباید با هم تداخل داشته باشند: ${names}`,
      invalid: overlappingWeekdays,
    }
  }

  return { message: '', invalid: [] }
}
