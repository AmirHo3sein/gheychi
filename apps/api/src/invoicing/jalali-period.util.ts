import { toGregorian, toJalaali } from 'jalaali-js';
import { iranWallClockToInstant, shiftToIranLocal } from '../common/iran-time.util';

export interface JalaliMonth {
  year: number;
  month: number; // 1-12
}

/**
 * The Iran-local Jalali (year, month) an instant falls in -- same Iran-local shift
 * common/iran-time.util.ts uses to bucket a booking slot under its Iran-local calendar
 * date, applied here to bucket a commission row under its Iran-local month.
 */
export function jalaliMonthOf(instant: Date): JalaliMonth {
  const iranLocal = shiftToIranLocal(instant);
  const { jy, jm } = toJalaali(iranLocal.getUTCFullYear(), iranLocal.getUTCMonth() + 1, iranLocal.getUTCDate());
  return { year: jy, month: jm };
}

function nextJalaliMonth({ year, month }: JalaliMonth): JalaliMonth {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** Iran-local midnight of the given Gregorian calendar date, as a real UTC instant. */
function iranMidnightToInstant(gy: number, gm: number, gd: number): Date {
  const dateStr = `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
  return iranWallClockToInstant(dateStr, 0);
}

/**
 * [periodStart, periodEnd) as real UTC instants -- periodEnd is Iran-local midnight of
 * the FIRST day of the NEXT Jalali month, i.e. an exclusive upper bound, matching the
 * half-open range every financial_transactions query against these bounds uses.
 */
export function jalaliMonthBounds(month: JalaliMonth): { periodStart: Date; periodEnd: Date } {
  const start = toGregorian(month.year, month.month, 1);
  const end = toGregorian(nextJalaliMonth(month).year, nextJalaliMonth(month).month, 1);
  return {
    periodStart: iranMidnightToInstant(start.gy, start.gm, start.gd),
    periodEnd: iranMidnightToInstant(end.gy, end.gm, end.gd),
  };
}

/** Whether the given Jalali month has fully ended as of `now` (periodEnd <= now). */
export function isJalaliMonthClosed(month: JalaliMonth, now: Date): boolean {
  return jalaliMonthBounds(month).periodEnd <= now;
}
