import { computeAvailableSlots } from './availability.util';

describe('computeAvailableSlots', () => {
  const NOW = new Date('2026-08-03T08:00:00.000Z'); // a Monday, 08:00 UTC

  it('generates slots stepping by duration within a single open range', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '12:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-08-03');
    expect(result[0].slots).toEqual([
      '2026-08-03T09:00:00.000Z',
      '2026-08-03T10:00:00.000Z',
      '2026-08-03T11:00:00.000Z',
    ]);
  });

  it('does not generate a slot that would run past closing time', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 90,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '10:30:00' }]]]),
      closedDates: new Set(),
      existingBookings: [],
    });
    // exactly one 90-minute slot fits 09:00-10:30; a second would end at 12:00, past close
    expect(result[0].slots).toEqual(['2026-08-03T09:00:00.000Z']);
  });

  it('handles multiple open ranges on the same day independently', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [
        { openTime: '09:00:00', closeTime: '11:00:00' },
        { openTime: '15:00:00', closeTime: '17:00:00' },
      ]]]),
      closedDates: new Set(),
      existingBookings: [],
    });
    expect(result[0].slots).toEqual([
      '2026-08-03T09:00:00.000Z',
      '2026-08-03T10:00:00.000Z',
      '2026-08-03T15:00:00.000Z',
      '2026-08-03T16:00:00.000Z',
    ]);
  });

  it('excludes a date entirely when there are no working hours for that weekday', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 2,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '10:00:00' }]]]), // only Monday
      closedDates: new Set(),
      existingBookings: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-08-03');
  });

  it('excludes a date listed in closedDates even if it has working hours', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '10:00:00' }]]]),
      closedDates: new Set(['2026-08-03']),
      existingBookings: [],
    });
    expect(result).toHaveLength(0);
  });

  it('excludes a slot once existing bookings fill it to capacity', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 2,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '11:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [
        { startsAt: new Date('2026-08-03T09:00:00.000Z'), endsAt: new Date('2026-08-03T10:00:00.000Z') },
        { startsAt: new Date('2026-08-03T09:00:00.000Z'), endsAt: new Date('2026-08-03T10:00:00.000Z') },
      ],
    });
    // 09:00 has 2 overlapping bookings === capacity, so it's full; 10:00 is untouched
    expect(result[0].slots).toEqual(['2026-08-03T10:00:00.000Z']);
  });

  it('counts a booking as overlapping even if it does not start exactly on the candidate boundary', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '11:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [
        // an existing 09:30-10:30 booking overlaps both the 09:00-10:00 and 10:00-11:00 candidates
        { startsAt: new Date('2026-08-03T09:30:00.000Z'), endsAt: new Date('2026-08-03T10:30:00.000Z') },
      ],
    });
    expect(result).toHaveLength(0);
  });

  it('excludes candidate start times that have already passed today, but keeps future ones', () => {
    const result = computeAvailableSlots({
      now: new Date('2026-08-03T09:30:00.000Z'), // 09:30 on the same Monday
      days: 1,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '12:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [],
    });
    // 09:00 has already started/passed; 10:00 and 11:00 remain
    expect(result[0].slots).toEqual(['2026-08-03T10:00:00.000Z', '2026-08-03T11:00:00.000Z']);
  });

  it('does not exclude past-today times on future days', () => {
    const result = computeAvailableSlots({
      now: new Date('2026-08-03T09:30:00.000Z'), // 09:30 on the Monday
      days: 2,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([
        [1, [{ openTime: '09:00:00', closeTime: '11:00:00' }]], // Monday: 09:00 candidate is past, 10:00 remains
        [2, [{ openTime: '09:00:00', closeTime: '10:00:00' }]], // Tuesday: a future day, its 09:00 must NOT be excluded
      ]),
      closedDates: new Set(),
      existingBookings: [],
    });
    expect(result).toHaveLength(2);
    expect(result[0].slots).toEqual(['2026-08-03T10:00:00.000Z']);
    expect(result[1].slots).toEqual(['2026-08-04T09:00:00.000Z']);
  });

  it('returns an empty array when nothing is available across the whole window', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 3,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map(),
      closedDates: new Set(),
      existingBookings: [],
    });
    expect(result).toEqual([]);
  });
});
