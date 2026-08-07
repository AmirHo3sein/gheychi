import { IRAN_UTC_OFFSET_MIN, iranDateString, iranWallClockToInstant, iranWeekday, shiftToIranLocal } from './iran-time.util';

describe('IRAN_UTC_OFFSET_MIN', () => {
  it('is 210 minutes (UTC+3:30)', () => {
    expect(IRAN_UTC_OFFSET_MIN).toBe(210);
  });
});

describe('shiftToIranLocal', () => {
  it('adds 3h30m to a UTC instant', () => {
    const result = shiftToIranLocal(new Date('2026-07-11T00:00:00.000Z'));
    expect(result.toISOString()).toBe('2026-07-11T03:30:00.000Z');
  });
});

describe('iranDateString', () => {
  it('returns the UTC date unchanged when well within the Iran-local day', () => {
    expect(iranDateString(new Date('2026-07-11T10:00:00.000Z'))).toBe('2026-07-11');
  });

  it('rolls forward to the next Iran-local date between 20:30 and 24:00 UTC', () => {
    // 21:00 UTC + 3:30 = 00:30 the next day in Iran.
    expect(iranDateString(new Date('2026-07-11T21:00:00.000Z'))).toBe('2026-07-12');
  });
});

describe('iranWeekday', () => {
  it('matches getUTCDay() on the shifted instant', () => {
    const instant = new Date('2026-07-11T10:00:00.000Z');
    expect(iranWeekday(instant)).toBe(shiftToIranLocal(instant).getUTCDay());
  });
});

describe('iranWallClockToInstant', () => {
  it('converts 09:00 Iran-local wall clock to 05:30Z, not 09:00Z', () => {
    const instant = iranWallClockToInstant('2026-07-11', 9 * 60);
    expect(instant.toISOString()).toBe('2026-07-11T05:30:00.000Z');
  });

  it('converts Iran-local midnight (minutesFromMidnight: 0) to the previous UTC day at 20:30', () => {
    const instant = iranWallClockToInstant('2026-07-11', 0);
    expect(instant.toISOString()).toBe('2026-07-10T20:30:00.000Z');
  });

  it('round-trips with iranDateString for a mid-day instant', () => {
    const original = new Date('2026-07-11T10:00:00.000Z');
    const dateStr = iranDateString(original);
    // 10:00 UTC is 13:30 Iran-local -- reconstructing from (dateStr, 13*60+30) must
    // recover the exact original instant.
    const reconstructed = iranWallClockToInstant(dateStr, 13 * 60 + 30);
    expect(reconstructed.getTime()).toBe(original.getTime());
  });
});
