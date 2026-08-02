import { isJalaliMonthClosed, jalaliMonthBounds, jalaliMonthOf } from './jalali-period.util';

describe('jalaliMonthOf / jalaliMonthBounds (invariants, not hardcoded calendar magic)', () => {
  it('buckets periodStart itself under the same month it was computed for', () => {
    const month = { year: 1403, month: 7 };
    const { periodStart } = jalaliMonthBounds(month);
    expect(jalaliMonthOf(periodStart)).toEqual(month);
  });

  it('buckets the instant just before periodEnd under the same month (inclusive upper bound minus 1ms)', () => {
    const month = { year: 1403, month: 7 };
    const { periodEnd } = jalaliMonthBounds(month);
    expect(jalaliMonthOf(new Date(periodEnd.getTime() - 1))).toEqual(month);
  });

  it('buckets periodEnd itself under the NEXT month -- periodEnd is an exclusive upper bound', () => {
    const month = { year: 1403, month: 7 };
    const { periodEnd } = jalaliMonthBounds(month);
    expect(jalaliMonthOf(periodEnd)).toEqual({ year: 1403, month: 8 });
  });

  it('rolls over the Jalali year at month 12 -> next year month 1', () => {
    const { periodEnd } = jalaliMonthBounds({ year: 1403, month: 12 });
    expect(jalaliMonthOf(periodEnd)).toEqual({ year: 1404, month: 1 });
  });

  it('spans a plausible month length (29-31 days) between periodStart and periodEnd', () => {
    const { periodStart, periodEnd } = jalaliMonthBounds({ year: 1403, month: 7 });
    const days = (periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60_000);
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(31);
  });

  it('sets periodStart to Iran-local midnight, not UTC midnight', () => {
    const { periodStart } = jalaliMonthBounds({ year: 1403, month: 7 });
    const iranHour = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Tehran' }).format(
      periodStart,
    );
    expect(iranHour).toBe('00');
  });

  // Spot-check against a well-documented real date: Nowruz (1 Farvardin) 1403 fell on
  // 2024-03-20 -- Iran midnight that day is 20:30 UTC the day before (Iran is UTC+3:30).
  it('matches the known real-world date for 1 Farvandin 1403 (Nowruz 2024)', () => {
    const { periodStart } = jalaliMonthBounds({ year: 1403, month: 1 });
    expect(periodStart.toISOString()).toBe('2024-03-19T20:30:00.000Z');
  });
});

describe('isJalaliMonthClosed', () => {
  it('is true once now has reached periodEnd', () => {
    const month = { year: 1403, month: 7 };
    const { periodEnd } = jalaliMonthBounds(month);
    expect(isJalaliMonthClosed(month, periodEnd)).toBe(true);
    expect(isJalaliMonthClosed(month, new Date(periodEnd.getTime() + 1))).toBe(true);
  });

  it('is false while now is still inside the month', () => {
    const month = { year: 1403, month: 7 };
    const { periodStart, periodEnd } = jalaliMonthBounds(month);
    expect(isJalaliMonthClosed(month, periodStart)).toBe(false);
    expect(isJalaliMonthClosed(month, new Date(periodEnd.getTime() - 1))).toBe(false);
  });
});
