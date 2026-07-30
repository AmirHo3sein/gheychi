export interface WorkingHourRange {
  openTime: string; // 'HH:MM:SS' or 'HH:MM', as returned by Postgres's `time` type
  closeTime: string;
}

export interface BookingInterval {
  startsAt: Date;
  endsAt: Date;
}

export interface ComputeAvailabilityParams {
  now: Date;
  days: number;
  durationMin: number;
  capacity: number;
  hoursByWeekday: Map<number, WorkingHourRange[]>;
  closedDates: Set<string>;
  existingBookings: BookingInterval[];
}

export interface DayAvailability {
  date: string; // 'YYYY-MM-DD'
  slots: string[]; // ISO 8601 UTC start times
}

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Iran is UTC+3:30 year-round -- the country abolished DST in 2022, so a fixed offset is
 * correct rather than a simplification. Kept as one named constant because it is applied in
 * both directions (wall clock -> instant, instant -> local date) and the two must agree.
 */
export const IRAN_UTC_OFFSET_MIN = 210;

/**
 * The Iran-local calendar date an instant falls on. NOT the same as the UTC date: between
 * 00:00 and 03:30 Iran time the UTC date is still the previous day, so using the UTC date
 * here would bucket those slots under yesterday -- and look up yesterday's weekday hours.
 */
function iranDateString(instant: Date): string {
  return new Date(instant.getTime() + IRAN_UTC_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** The Iran-local day-of-week (0 = Sunday) an instant falls on. */
function iranWeekday(instant: Date): number {
  return new Date(instant.getTime() + IRAN_UTC_OFFSET_MIN * 60_000).getUTCDay();
}

/**
 * Converts a wall-clock reading on an Iran-local date into the real UTC instant it denotes.
 * working_hours.open_time/close_time are Postgres `time` values holding exactly what the
 * provider typed on their own clock, so 09:00 on 2026-07-11 is 05:30Z -- not 09:00Z.
 */
function iranWallClockToInstant(dateStr: string, minutesFromMidnight: number): Date {
  const midnightUtcOfDate = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  return new Date(midnightUtcOfDate + (minutesFromMidnight - IRAN_UTC_OFFSET_MIN) * 60_000);
}

/**
 * Every Date crossing this module's boundary is a REAL instant: `now` is a true UTC instant,
 * the returned slot strings are true UTC instants, and `existingBookings` are the true
 * instants stored in `bookings.starts_at`/`ends_at`. Only working-hour times are wall-clock,
 * and they are converted on the way in by `iranWallClockToInstant`.
 *
 * This module previously treated wall-clock digits as if they were UTC digits and required
 * every caller to pass `now` the same skewed way. It didn't: `AvailabilityService` passed a
 * genuine `new Date()`, and every display path formats the returned instants in Asia/Tehran
 * -- so a salon open 09:00-20:00 offered slots that rendered as 12:30-23:30, i.e. three
 * hours past closing and never during its first 3.5 open hours. Keep the conversion at this
 * boundary; do not reintroduce a naive-digits shortcut in any caller.
 */
export function computeAvailableSlots(params: ComputeAvailabilityParams): DayAvailability[] {
  const { now, days, durationMin, capacity, hoursByWeekday, closedDates, existingBookings } = params;
  const results: DayAvailability[] = [];

  // A zero or negative duration would make `cursorMin += durationMin` in the loop
  // below never advance (or advance backwards while the `<=` bound only shrinks),
  // producing an infinite synchronous loop that hangs the whole Node process --
  // not just one request. This should never happen given upstream DTO validation,
  // but this function is also fed durationMin read back from the database (a
  // later task's AvailabilityService), which this function has no way to verify,
  // so it guards itself rather than trusting every caller forever.
  if (durationMin <= 0) return [];

  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const day = new Date(now.getTime() + dayOffset * 24 * 60 * 60_000);
    // Iran-local date/weekday, so "today" and the working-hour lookup both match the
    // calendar the salon and the customer are actually looking at. (Iran's offset is fixed,
    // so advancing 24h always advances the local date by exactly one.)
    const dateStr = iranDateString(day);
    if (closedDates.has(dateStr)) continue;

    const weekday = iranWeekday(day);
    const ranges = hoursByWeekday.get(weekday);
    if (!ranges || ranges.length === 0) continue;

    const daySlots: string[] = [];
    for (const range of ranges) {
      const openMin = parseTimeToMinutes(range.openTime);
      const closeMin = parseTimeToMinutes(range.closeTime);

      for (let cursorMin = openMin; cursorMin + durationMin <= closeMin; cursorMin += durationMin) {
        const candidateStart = iranWallClockToInstant(dateStr, cursorMin);
        const candidateEnd = iranWallClockToInstant(dateStr, cursorMin + durationMin);

        if (candidateStart <= now) continue;

        const overlapCount = existingBookings.filter(
          (b) => b.startsAt < candidateEnd && b.endsAt > candidateStart,
        ).length;
        if (overlapCount >= capacity) continue;

        daySlots.push(candidateStart.toISOString());
      }
    }

    // Ranges aren't guaranteed to be given (or stored) in chronological order --
    // sort so callers always get ascending start times regardless of input order.
    if (daySlots.length > 0) results.push({ date: dateStr, slots: daySlots.sort() });
  }

  return results;
}
