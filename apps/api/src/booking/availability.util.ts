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

export function computeAvailableSlots(params: ComputeAvailabilityParams): DayAvailability[] {
  const { now, days, durationMin, capacity, hoursByWeekday, closedDates, existingBookings } = params;
  const results: DayAvailability[] = [];

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

    if (daySlots.length > 0) results.push({ date: dateStr, slots: daySlots });
  }

  return results;
}
