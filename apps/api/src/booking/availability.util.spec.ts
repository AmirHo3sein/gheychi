import { computeAvailableSlots } from './availability.util';

/**
 * Working-hour times are Iran wall clock (what the provider typed); every Date in and out of
 * computeAvailableSlots is a real UTC instant. Iran is UTC+3:30, so a 09:00 opening is
 * 05:30Z -- these expectations are written in real instants for that reason. `formatSlotTime`
 * in the user-app then renders 05:30Z back as 09:00 Asia/Tehran, which is the whole point.
 */
describe('computeAvailableSlots', () => {
  // 05:30 Iran on Monday 2026-08-03 -- early enough that a 09:00-17:00 salon day is entirely
  // in the future. (At the old 08:00Z the Iran clock is already 11:30, so most of the day has
  // passed and every slot assertion below would trivially be empty.)
  const NOW = new Date('2026-08-03T02:00:00.000Z');

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
    // wall clock 09:00 / 10:00 / 11:00 Iran
    expect(result[0].slots).toEqual([
      '2026-08-03T05:30:00.000Z',
      '2026-08-03T06:30:00.000Z',
      '2026-08-03T07:30:00.000Z',
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
    expect(result[0].slots).toEqual(['2026-08-03T05:30:00.000Z']);
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
    // wall clock 09:00 / 10:00 / 15:00 / 16:00 Iran
    expect(result[0].slots).toEqual([
      '2026-08-03T05:30:00.000Z',
      '2026-08-03T06:30:00.000Z',
      '2026-08-03T11:30:00.000Z',
      '2026-08-03T12:30:00.000Z',
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
        // two real bookings occupying the 09:00-10:00 Iran slot
        { startsAt: new Date('2026-08-03T05:30:00.000Z'), endsAt: new Date('2026-08-03T06:30:00.000Z') },
        { startsAt: new Date('2026-08-03T05:30:00.000Z'), endsAt: new Date('2026-08-03T06:30:00.000Z') },
      ],
    });
    // 09:00 has 2 overlapping bookings === capacity, so it's full; 10:00 is untouched
    expect(result[0].slots).toEqual(['2026-08-03T06:30:00.000Z']);
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
        // an existing 09:30-10:30 Iran booking overlaps both the 09:00 and 10:00 candidates
        { startsAt: new Date('2026-08-03T06:00:00.000Z'), endsAt: new Date('2026-08-03T07:00:00.000Z') },
      ],
    });
    expect(result).toHaveLength(0);
  });

  it('excludes candidate start times that have already passed today, but keeps future ones', () => {
    const result = computeAvailableSlots({
      now: new Date('2026-08-03T06:00:00.000Z'), // 09:30 Iran on the same Monday
      days: 1,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '12:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [],
    });
    // 09:00 Iran has already started/passed; 10:00 and 11:00 Iran remain
    expect(result[0].slots).toEqual(['2026-08-03T06:30:00.000Z', '2026-08-03T07:30:00.000Z']);
  });

  it('does not exclude past-today times on future days', () => {
    const result = computeAvailableSlots({
      now: new Date('2026-08-03T06:00:00.000Z'), // 09:30 Iran on the Monday
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
    expect(result[0].slots).toEqual(['2026-08-03T06:30:00.000Z']);
    expect(result[1].slots).toEqual(['2026-08-04T05:30:00.000Z']);
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

  it('returns an empty array instead of hanging when durationMin is zero or negative', () => {
    const zero = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 0,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '12:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [],
    });
    expect(zero).toEqual([]);

    const negative = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: -30,
      capacity: 1,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '12:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [],
    });
    expect(negative).toEqual([]);
  });

  it('excludes a slot for the requested worker even when the salon has spare capacity', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 3, // plenty of salon-wide room -- the worker is still the constraint
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '11:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [
        {
          startsAt: new Date('2026-08-03T05:30:00.000Z'),
          endsAt: new Date('2026-08-03T06:30:00.000Z'),
          workerId: 'worker-1',
        },
      ],
      requestedWorkerId: 'worker-1',
    });
    // 09:00 is this worker's own conflict; 10:00 remains free for them.
    expect(result[0].slots).toEqual(['2026-08-03T06:30:00.000Z']);
  });

  it('does not exclude a slot for a DIFFERENT worker than the one that is busy', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 3,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '10:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [
        {
          startsAt: new Date('2026-08-03T05:30:00.000Z'),
          endsAt: new Date('2026-08-03T06:30:00.000Z'),
          workerId: 'worker-1',
        },
      ],
      requestedWorkerId: 'worker-2',
    });
    expect(result[0].slots).toEqual(['2026-08-03T05:30:00.000Z']);
  });

  it('ignores workerId on existing bookings entirely when no specific worker is requested', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 3,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '10:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [
        {
          startsAt: new Date('2026-08-03T05:30:00.000Z'),
          endsAt: new Date('2026-08-03T06:30:00.000Z'),
          workerId: 'worker-1',
        },
      ],
      // no requestedWorkerId -- "any available staff", unaffected by which worker a booking names
    });
    expect(result[0].slots).toEqual(['2026-08-03T05:30:00.000Z']);
  });

  it('treats a null workerId on an existing booking as never matching a requested worker', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 3,
      hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '10:00:00' }]]]),
      closedDates: new Set(),
      existingBookings: [
        {
          startsAt: new Date('2026-08-03T05:30:00.000Z'),
          endsAt: new Date('2026-08-03T06:30:00.000Z'),
          workerId: null, // a solo-owner-operated-salon-style booking with no worker assigned
        },
      ],
      requestedWorkerId: 'worker-1',
    });
    expect(result[0].slots).toEqual(['2026-08-03T05:30:00.000Z']);
  });

  it('returns slots in chronological order even when working-hour ranges are given out of order', () => {
    const result = computeAvailableSlots({
      now: NOW,
      days: 1,
      durationMin: 60,
      capacity: 1,
      hoursByWeekday: new Map([[1, [
        { openTime: '15:00:00', closeTime: '17:00:00' },
        { openTime: '09:00:00', closeTime: '11:00:00' },
      ]]]),
      closedDates: new Set(),
      existingBookings: [],
    });
    // wall clock 09:00 / 10:00 / 15:00 / 16:00 Iran
    expect(result[0].slots).toEqual([
      '2026-08-03T05:30:00.000Z',
      '2026-08-03T06:30:00.000Z',
      '2026-08-03T11:30:00.000Z',
      '2026-08-03T12:30:00.000Z',
    ]);
  });

  describe('Iran wall-clock convention (regression guards)', () => {
    /** What the customer/provider actually sees, via the same formatter the user-app uses. */
    const asTehran = (iso: string) =>
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Tehran',
      }).format(new Date(iso));

    it('surfaces a 09:00 opening as 09:00 on the salon\'s own clock, not 12:30', () => {
      // The bug this exists to prevent: slots were built as if the stored digits were UTC,
      // so a salon open 09:00-20:00 was bookable 12:30-23:30 -- three hours past closing,
      // and never during its first 3.5 open hours.
      const result = computeAvailableSlots({
        now: new Date('2026-08-03T02:00:00.000Z'), // 05:30 Iran, before opening
        days: 1,
        durationMin: 60,
        capacity: 1,
        hoursByWeekday: new Map([[1, [{ openTime: '09:00:00', closeTime: '20:00:00' }]]]),
        closedDates: new Set(),
        existingBookings: [],
      });
      const slots = result[0].slots;
      expect(asTehran(slots[0])).toBe('09:00');
      // Last 60-minute slot starts at 19:00 and ends exactly at close.
      expect(asTehran(slots[slots.length - 1])).toBe('19:00');
      // Nothing is ever offered outside the hours the provider actually set.
      for (const slot of slots) {
        const hhmm = asTehran(slot);
        expect(hhmm >= '09:00').toBe(true);
        expect(hhmm <= '19:00').toBe(true);
      }
    });

    it('buckets slots under the Iran calendar day, not the UTC one, after Iran midnight', () => {
      // 21:00Z is already 00:30 the NEXT day in Iran. Using the UTC date here would label the
      // day with yesterday's date AND look up yesterday's weekday hours.
      const now = new Date('2026-08-03T21:00:00.000Z'); // Tue 2026-08-04, 00:30 Iran
      const result = computeAvailableSlots({
        now,
        days: 1,
        durationMin: 60,
        capacity: 1,
        // Tuesday only. If the UTC date/weekday were used this would resolve to Monday and
        // return nothing.
        hoursByWeekday: new Map([[2, [{ openTime: '09:00:00', closeTime: '11:00:00' }]]]),
        closedDates: new Set(),
        existingBookings: [],
      });
      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-08-04');
      expect(asTehran(result[0].slots[0])).toBe('09:00');
    });

    it('honours a closed-date exception against the Iran calendar day', () => {
      const result = computeAvailableSlots({
        now: new Date('2026-08-03T21:00:00.000Z'), // 00:30 Iran on 2026-08-04
        days: 1,
        durationMin: 60,
        capacity: 1,
        hoursByWeekday: new Map([[2, [{ openTime: '09:00:00', closeTime: '11:00:00' }]]]),
        closedDates: new Set(['2026-08-04']), // the Iran date the provider closed
        existingBookings: [],
      });
      expect(result).toHaveLength(0);
    });
  });
});
