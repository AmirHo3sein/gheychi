import { iranWallClockToInstant, iranWeekday } from '../common/iran-time.util';
import { BookingInterval, DateException, parseTimeToMinutes, subtractInterval, WorkingHourRange } from './availability.util';

export interface ComputeDailyCapacityParams {
  dates: string[]; // Iran-local 'YYYY-MM-DD', ascending
  // Concurrent chairs -- the same single salon-wide number computeAvailableSlots caps
  // overlapping bookings at. Workers are NOT a capacity dimension in that model (a worker
  // only narrows availability when a customer picks one), so they are not one here either.
  capacity: number;
  hoursByWeekday: Map<number, WorkingHourRange[]>;
  // Whole-salon exceptions only, keyed by date -- exactly the map AvailabilityService
  // builds. Per-worker time off never closes chairs in the availability model.
  exceptionsByDate: Map<string, DateException>;
  bookings: BookingInterval[]; // slot-blocking bookings overlapping the window
}

export type DayClosedReason = 'no_hours' | 'closed_exception';

export interface DayCapacity {
  date: string;
  weekday: number; // 0 = Sunday, Iran-local
  closedReason: DayClosedReason | null;
  openMinutes: number; // working hours minus that day's exception
  capacityMinutes: number; // openMinutes x capacity: chair-minutes on offer
  bookedMinutes: number; // chair-minutes taken by slot-blocking bookings, inside open hours only
  freeMinutes: number; // max(0, capacityMinutes - bookedMinutes)
  freePercent: number | null; // null when nothing was on offer -- "closed" is not "0% free"
  bookingsCount: number; // slot-blocking bookings that start on this date
}

interface Interval {
  start: number; // epoch ms
  end: number;
}

const MINUTE_MS = 60_000;

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else merged.push({ ...iv });
  }
  return merged;
}

/**
 * Per-day chair-time for a salon: what was on offer (open hours x capacity) and how much
 * of it slot-blocking bookings already hold. The open-hours part reuses the availability
 * engine's own pieces (weekday ranges, `subtractInterval` for a partial exception, the
 * same Iran wall-clock -> instant conversion) so "open" means exactly what the slot grid
 * thinks it means.
 *
 * Deliberately minutes, not slots: a slot count depends on which service's duration you
 * walk the day with, so there is no single honest "empty slots" number for a salon.
 *
 * A booking is counted only for the part of it that falls inside open hours (a manual
 * booking recorded outside them takes no on-offer capacity), and overlapping working-hour
 * rows are merged first so a day is never counted twice. A whole day is counted, including
 * the part of today that is already over.
 */
export function computeDailyCapacity(params: ComputeDailyCapacityParams): DayCapacity[] {
  const { dates, capacity, hoursByWeekday, exceptionsByDate, bookings } = params;
  const chairs = Math.max(0, capacity);

  return dates.map((date) => {
    // Noon, not midnight, so the weekday read is nowhere near a day boundary.
    const weekday = iranWeekday(iranWallClockToInstant(date, 12 * 60));
    const exception = exceptionsByDate.get(date);
    const ranges = hoursByWeekday.get(weekday) ?? [];

    let closedReason: DayClosedReason | null = null;
    let open: Interval[] = [];
    if (exception === 'whole-day') {
      closedReason = 'closed_exception';
    } else if (ranges.length === 0) {
      closedReason = 'no_hours';
    } else {
      const openRanges = ranges.flatMap((range) => (exception ? subtractInterval(range, exception) : [range]));
      open = mergeIntervals(
        openRanges
          .map((r) => ({
            start: iranWallClockToInstant(date, parseTimeToMinutes(r.openTime)).getTime(),
            end: iranWallClockToInstant(date, parseTimeToMinutes(r.closeTime)).getTime(),
          }))
          .filter((iv) => iv.end > iv.start),
      );
      // Hours exist but a partial exception swallowed all of them.
      if (open.length === 0) closedReason = 'closed_exception';
    }

    const openMinutes = open.reduce((sum, iv) => sum + (iv.end - iv.start) / MINUTE_MS, 0);
    const capacityMinutes = openMinutes * chairs;

    const dayStart = iranWallClockToInstant(date, 0).getTime();
    const dayEnd = iranWallClockToInstant(date, 24 * 60).getTime();
    let bookedMinutes = 0;
    let bookingsCount = 0;
    for (const b of bookings) {
      const bStart = b.startsAt.getTime();
      const bEnd = b.endsAt.getTime();
      if (bStart >= dayStart && bStart < dayEnd) bookingsCount++;
      for (const iv of open) {
        const overlap = Math.min(bEnd, iv.end) - Math.max(bStart, iv.start);
        if (overlap > 0) bookedMinutes += overlap / MINUTE_MS;
      }
    }

    bookedMinutes = Math.round(bookedMinutes);
    const freeMinutes = Math.max(0, Math.round(capacityMinutes) - bookedMinutes);
    return {
      date,
      weekday,
      closedReason,
      openMinutes: Math.round(openMinutes),
      capacityMinutes: Math.round(capacityMinutes),
      bookedMinutes,
      freeMinutes,
      freePercent: capacityMinutes > 0 ? Math.round((freeMinutes / capacityMinutes) * 100) : null,
      bookingsCount,
    };
  });
}

/** 'YYYY-MM-DD' + n calendar days (pure date arithmetic, no timezone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days in [from, to). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}
