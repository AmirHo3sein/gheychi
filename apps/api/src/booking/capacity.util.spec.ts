import { iranWallClockToInstant } from '../common/iran-time.util';
import { DateException, WorkingHourRange } from './availability.util';
import { addDays, computeDailyCapacity, daysBetween } from './capacity.util';

// 2026-10-17 is a Saturday (weekday 6) in Iran; 2026-10-18 a Sunday (0).
const SAT = '2026-10-17';
const SUN = '2026-10-18';

function at(date: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return iranWallClockToInstant(date, h * 60 + m);
}

function hours(entries: Array<[number, string, string]>): Map<number, WorkingHourRange[]> {
  const map = new Map<number, WorkingHourRange[]>();
  for (const [weekday, openTime, closeTime] of entries) {
    map.set(weekday, [...(map.get(weekday) ?? []), { openTime, closeTime }]);
  }
  return map;
}

describe('computeDailyCapacity', () => {
  it('multiplies open minutes by capacity and subtracts booked chair-minutes', () => {
    const [day] = computeDailyCapacity({
      dates: [SAT],
      capacity: 2,
      hoursByWeekday: hours([[6, '09:00:00', '17:00:00']]),
      exceptionsByDate: new Map(),
      bookings: [
        { startsAt: at(SAT, '10:00'), endsAt: at(SAT, '11:00') },
        { startsAt: at(SAT, '10:00'), endsAt: at(SAT, '10:30') },
      ],
    });
    expect(day).toEqual({
      date: SAT,
      weekday: 6,
      closedReason: null,
      openMinutes: 480,
      capacityMinutes: 960,
      bookedMinutes: 90,
      freeMinutes: 870,
      freePercent: 91,
      bookingsCount: 2,
    });
  });

  it('reports a day with no working hours as closed with a null freePercent, not 0%', () => {
    const [day] = computeDailyCapacity({
      dates: [SUN],
      capacity: 3,
      hoursByWeekday: hours([[6, '09:00', '17:00']]),
      exceptionsByDate: new Map(),
      bookings: [],
    });
    expect(day).toMatchObject({ weekday: 0, closedReason: 'no_hours', openMinutes: 0, capacityMinutes: 0, freePercent: null });
  });

  it('closes the whole day for a whole-day exception', () => {
    const [day] = computeDailyCapacity({
      dates: [SAT],
      capacity: 1,
      hoursByWeekday: hours([[6, '09:00', '17:00']]),
      exceptionsByDate: new Map<string, DateException>([[SAT, 'whole-day']]),
      bookings: [],
    });
    expect(day).toMatchObject({ closedReason: 'closed_exception', openMinutes: 0, freePercent: null });
  });

  it('removes a partial exception from the open minutes (reusing the availability engine subtraction)', () => {
    const [day] = computeDailyCapacity({
      dates: [SAT],
      capacity: 1,
      hoursByWeekday: hours([[6, '09:00', '17:00']]),
      exceptionsByDate: new Map<string, DateException>([[SAT, { startTime: '12:00', endTime: '14:00' }]]),
      bookings: [],
    });
    expect(day).toMatchObject({ closedReason: null, openMinutes: 360, capacityMinutes: 360, freePercent: 100 });
  });

  it('treats a partial exception that covers every open hour as closed', () => {
    const [day] = computeDailyCapacity({
      dates: [SAT],
      capacity: 1,
      hoursByWeekday: hours([[6, '09:00', '12:00']]),
      exceptionsByDate: new Map<string, DateException>([[SAT, { startTime: '08:00', endTime: '13:00' }]]),
      bookings: [],
    });
    expect(day).toMatchObject({ closedReason: 'closed_exception', openMinutes: 0, freePercent: null });
  });

  it('merges overlapping working-hour rows instead of double counting them', () => {
    const [day] = computeDailyCapacity({
      dates: [SAT],
      capacity: 1,
      hoursByWeekday: hours([
        [6, '09:00', '13:00'],
        [6, '12:00', '15:00'],
      ]),
      exceptionsByDate: new Map(),
      bookings: [],
    });
    expect(day.openMinutes).toBe(360);
  });

  it('counts only the part of a booking inside open hours (a manual booking after closing takes no on-offer capacity)', () => {
    const [day] = computeDailyCapacity({
      dates: [SAT],
      capacity: 1,
      hoursByWeekday: hours([[6, '09:00', '17:00']]),
      exceptionsByDate: new Map(),
      bookings: [
        { startsAt: at(SAT, '16:30'), endsAt: at(SAT, '17:30') },
        { startsAt: at(SAT, '19:00'), endsAt: at(SAT, '20:00') },
      ],
    });
    expect(day).toMatchObject({ bookedMinutes: 30, bookingsCount: 2 });
  });

  it('never reports negative free time when bookings exceed capacity', () => {
    const [day] = computeDailyCapacity({
      dates: [SAT],
      capacity: 1,
      hoursByWeekday: hours([[6, '09:00', '10:00']]),
      exceptionsByDate: new Map(),
      bookings: [
        { startsAt: at(SAT, '09:00'), endsAt: at(SAT, '10:00') },
        { startsAt: at(SAT, '09:00'), endsAt: at(SAT, '10:00') },
      ],
    });
    expect(day).toMatchObject({ capacityMinutes: 60, bookedMinutes: 120, freeMinutes: 0, freePercent: 0 });
  });

  it('buckets by the Iran-local day: a booking at 01:00 Tehran belongs to that date, not the UTC previous day', () => {
    const days = computeDailyCapacity({
      dates: [SAT, SUN],
      capacity: 1,
      hoursByWeekday: hours([
        [6, '00:00', '23:00'],
        [0, '00:00', '23:00'],
      ]),
      exceptionsByDate: new Map(),
      bookings: [{ startsAt: at(SUN, '01:00'), endsAt: at(SUN, '02:00') }],
    });
    expect(days.map((d) => [d.date, d.bookingsCount, d.bookedMinutes])).toEqual([
      [SAT, 0, 0],
      [SUN, 1, 60],
    ]);
  });
});

describe('capacity date helpers', () => {
  it('adds calendar days across a month boundary', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  });
  it('counts whole days in [from, to)', () => {
    expect(daysBetween('2026-10-16', '2026-10-23')).toBe(7);
    expect(daysBetween('2026-10-16', '2026-10-16')).toBe(0);
  });
});
