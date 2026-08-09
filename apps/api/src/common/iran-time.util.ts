/**
 * Iran is UTC+3:30 year-round -- the country abolished DST in 2022, so a fixed offset is
 * correct rather than a simplification. Kept as one named constant because it is applied
 * in both directions (wall clock -> instant, instant -> local date) and the two must
 * agree. Single source of truth for both `booking/availability.util.ts` (Iran-local
 * weekday/date bucketing for the slot grid) and `invoicing/jalali-period.util.ts`
 * (Iran-local Jalali month bucketing for commission rollups) -- previously the latter
 * re-implemented the same wall-clock<->instant arithmetic inline instead of importing it.
 */
export const IRAN_UTC_OFFSET_MIN = 210;

/** Shifts a real UTC instant forward by the Iran offset, for reading off Iran-local calendar fields. */
export function shiftToIranLocal(instant: Date): Date {
  return new Date(instant.getTime() + IRAN_UTC_OFFSET_MIN * 60_000);
}

/**
 * The Iran-local calendar date an instant falls on. NOT the same as the UTC date: between
 * 00:00 and 03:30 Iran time the UTC date is still the previous day, so using the UTC date
 * here would bucket those slots under yesterday -- and look up yesterday's weekday hours.
 */
export function iranDateString(instant: Date): string {
  return shiftToIranLocal(instant).toISOString().slice(0, 10);
}

/** The Iran-local day-of-week (0 = Sunday) an instant falls on. */
export function iranWeekday(instant: Date): number {
  return shiftToIranLocal(instant).getUTCDay();
}

/**
 * Converts a wall-clock reading on an Iran-local date into the real UTC instant it denotes.
 * `working_hours.open_time`/`close_time` are Postgres `time` values holding exactly what a
 * provider typed on their own clock, so 09:00 on 2026-07-11 is 05:30Z -- not 09:00Z.
 * `minutesFromMidnight: 0` (Iran-local midnight of `dateStr`) is what
 * `jalali-period.util.ts` uses to compute a Jalali month's period boundaries.
 */
export function iranWallClockToInstant(dateStr: string, minutesFromMidnight: number): Date {
  const midnightUtcOfDate = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  return new Date(midnightUtcOfDate + (minutesFromMidnight - IRAN_UTC_OFFSET_MIN) * 60_000);
}

/**
 * The single spot rendering an instant into the Persian-digit, Tehran-local date+time text
 * shown to customers in SMS/push bodies (booking confirmed/cancelled, reminders). Node's
 * Intl API resolves 'fa-IR' + Asia/Tehran identically to the frontend's own
 * `Intl.DateTimeFormat('fa-IR', {...})` display pattern, so a customer's confirmation text
 * and the booking card they see in the app always agree. Before this existed, notification
 * text used `booking.startsAt.toISOString()` directly -- a raw UTC instant 3.5 hours behind
 * the hour the customer actually booked.
 */
export function formatIranDateTimeFa(instant: Date): string {
  return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tehran' }).format(
    instant,
  );
}
