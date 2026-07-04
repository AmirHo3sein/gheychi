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

function dateStringUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function combineDateAndMinutes(dateStr: string, minutesFromMidnight: number): Date {
  const base = new Date(`${dateStr}T00:00:00.000Z`);
  return new Date(base.getTime() + minutesFromMidnight * 60_000);
}

/**
 * All Date values in this module are naive wall-clock instants -- no real
 * timezone conversion is ever applied. Iran has a fixed UTC+3:30 offset with
 * no DST since 2022, so `now`/DB-derived working-hour times are expected to
 * be passed consistently, as if UTC digits === Iran local-clock digits.
 * Never introduce a real tz conversion in only one of the call sites that
 * feed this function -- it would silently skew every open/close/past-time
 * comparison here by the timezone difference.
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
    const dateStr = dateStringUtc(day);
    if (closedDates.has(dateStr)) continue;

    const weekday = day.getUTCDay();
    const ranges = hoursByWeekday.get(weekday);
    if (!ranges || ranges.length === 0) continue;

    const daySlots: string[] = [];
    for (const range of ranges) {
      const openMin = parseTimeToMinutes(range.openTime);
      const closeMin = parseTimeToMinutes(range.closeTime);

      for (let cursorMin = openMin; cursorMin + durationMin <= closeMin; cursorMin += durationMin) {
        const candidateStart = combineDateAndMinutes(dateStr, cursorMin);
        const candidateEnd = combineDateAndMinutes(dateStr, cursorMin + durationMin);

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
