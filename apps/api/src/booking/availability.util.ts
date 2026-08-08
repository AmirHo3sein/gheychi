import { iranDateString, iranWallClockToInstant, iranWeekday } from '../common/iran-time.util';

export interface WorkingHourRange {
  openTime: string; // 'HH:MM:SS' or 'HH:MM', as returned by Postgres's `time` type
  closeTime: string;
}

export interface BookingInterval {
  startsAt: Date;
  endsAt: Date;
  // null for a booking with no worker assigned -- irrelevant to the requestedWorkerId
  // filter below, which only ever compares against a real id.
  workerId?: string | null;
}

// A date's schedule_exceptions row is either a whole-day closure (the original, still most
// common meaning -- both DB columns NULL) or a partial one narrowed to [startTime, endTime)
// on that date (the salon's normal working_hours still apply outside that interval). Using a
// 'whole-day' sentinel instead of a `{startTime:null,endTime:null}` shape lets every caller
// past the initial check work with a plainly-non-null {startTime,endTime}, no repeated
// null-checking.
export type DateException = 'whole-day' | { startTime: string; endTime: string };

export interface ComputeAvailabilityParams {
  now: Date;
  days: number;
  durationMin: number;
  capacity: number;
  hoursByWeekday: Map<number, WorkingHourRange[]>;
  exceptionsByDate: Map<string, DateException>;
  existingBookings: BookingInterval[];
  // When set, a slot is excluded if this specific worker already has an overlapping
  // booking -- independent of, and in ADDITION to, the salon-wide capacity check below.
  // A worker can only be in one place at a time regardless of how many chairs the salon
  // has free, so this is never merely "one more unit of capacity."
  requestedWorkerId?: string;
  // Per-worker whole-day time off (schedule_exceptions rows with a non-null worker_id),
  // keyed by worker id. Only ever consulted when requestedWorkerId is set -- "any
  // available worker" mode doesn't narrow by one worker's own days off, since a
  // colleague can still take the slot.
  workerOffDates?: Map<string, Set<string>>;
}

function minutesToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

// Removes [exception.startTime, exception.endTime) from `range`, returning the 0-2 remaining
// sub-ranges (0 when the exception fully covers the range, 2 when it sits strictly inside --
// e.g. 09:00-20:00 minus 13:00-14:00 -> 09:00-13:00 and 14:00-20:00 -- 1 when it clips only
// one edge or doesn't touch the range at all).
function subtractInterval(range: WorkingHourRange, exception: { startTime: string; endTime: string }): WorkingHourRange[] {
  const rangeOpen = parseTimeToMinutes(range.openTime);
  const rangeClose = parseTimeToMinutes(range.closeTime);
  const excStart = parseTimeToMinutes(exception.startTime);
  const excEnd = parseTimeToMinutes(exception.endTime);

  if (excEnd <= rangeOpen || excStart >= rangeClose) return [range];

  const result: WorkingHourRange[] = [];
  if (excStart > rangeOpen) result.push({ openTime: range.openTime, closeTime: minutesToTime(excStart) });
  if (excEnd < rangeClose) result.push({ openTime: minutesToTime(excEnd), closeTime: range.closeTime });
  return result;
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
  const { now, days, durationMin, capacity, hoursByWeekday, exceptionsByDate, existingBookings, requestedWorkerId, workerOffDates } = params;
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
    const exception = exceptionsByDate.get(dateStr);
    if (exception === 'whole-day') continue;

    if (requestedWorkerId && workerOffDates?.get(requestedWorkerId)?.has(dateStr)) continue;

    const weekday = iranWeekday(day);
    const ranges = hoursByWeekday.get(weekday);
    if (!ranges || ranges.length === 0) continue;

    const daySlots: string[] = [];
    for (const range of ranges) {
      // A partial exception narrows this range to its 0-2 remaining sub-ranges before
      // slots are walked; with no exception today, the range is used exactly as-is.
      const openRanges = exception ? subtractInterval(range, exception) : [range];

      for (const openRange of openRanges) {
        const openMin = parseTimeToMinutes(openRange.openTime);
        const closeMin = parseTimeToMinutes(openRange.closeTime);

        for (let cursorMin = openMin; cursorMin + durationMin <= closeMin; cursorMin += durationMin) {
          const candidateStart = iranWallClockToInstant(dateStr, cursorMin);
          const candidateEnd = iranWallClockToInstant(dateStr, cursorMin + durationMin);

          if (candidateStart <= now) continue;

          const overlapCount = existingBookings.filter(
            (b) => b.startsAt < candidateEnd && b.endsAt > candidateStart,
          ).length;
          if (overlapCount >= capacity) continue;

          if (requestedWorkerId) {
            const workerBusy = existingBookings.some(
              (b) => b.workerId === requestedWorkerId && b.startsAt < candidateEnd && b.endsAt > candidateStart,
            );
            if (workerBusy) continue;
          }

          daySlots.push(candidateStart.toISOString());
        }
      }
    }

    // Ranges aren't guaranteed to be given (or stored) in chronological order --
    // sort so callers always get ascending start times regardless of input order.
    if (daySlots.length > 0) results.push({ date: dateStr, slots: daySlots.sort() });
  }

  return results;
}
