import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { iranWallClockToInstant } from '../common/iran-time.util';
import { Salon } from '../salons/salon.entity';
import { ScheduleException } from '../salons/schedule-exception.entity';
import { WorkingHour } from '../salons/working-hour.entity';
import { Booking } from './booking.entity';
import { SalonCapacityService } from './salon-capacity.service';

// 2026-10-16T08:00Z is 11:30 on Friday 2026-10-16 in Tehran.
const NOW = new Date('2026-10-16T08:00:00.000Z');

describe('SalonCapacityService', () => {
  let service: SalonCapacityService;
  let salonFind: jest.Mock;
  let hoursFind: jest.Mock;
  let exceptionsFind: jest.Mock;
  let bookingsFind: jest.Mock;

  beforeEach(async () => {
    salonFind = jest.fn().mockResolvedValue({ id: 'salon-1', capacity: 2 });
    hoursFind = jest.fn().mockResolvedValue([{ weekday: 6, openTime: '09:00:00', closeTime: '17:00:00' }]);
    exceptionsFind = jest.fn().mockResolvedValue([]);
    bookingsFind = jest.fn().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        SalonCapacityService,
        { provide: getRepositoryToken(Salon), useValue: { findOneBy: salonFind } },
        { provide: getRepositoryToken(WorkingHour), useValue: { find: hoursFind } },
        { provide: getRepositoryToken(ScheduleException), useValue: { find: exceptionsFind } },
        { provide: getRepositoryToken(Booking), useValue: { find: bookingsFind } },
      ],
    }).compile();
    service = moduleRef.get(SalonCapacityService);
  });

  it('defaults to seven Tehran days starting today', async () => {
    const result = await service.compute('salon-1', {}, NOW);
    expect(result.from).toBe('2026-10-16');
    expect(result.to).toBe('2026-10-23');
    expect(result.days.map((d) => d.date)).toEqual([
      '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22',
    ]);
  });

  it('queries slot-blocking bookings over the Tehran window and only whole-salon exceptions', async () => {
    await service.compute('salon-1', { from: '2026-10-17', to: '2026-10-18' }, NOW);
    const where = bookingsFind.mock.calls[0][0].where;
    expect(where.salonId).toBe('salon-1');
    expect(where.status.value).toEqual(['pending_approval', 'pending_payment', 'confirmed']);
    expect(where.startsAt.value).toEqual(iranWallClockToInstant('2026-10-18', 0));
    expect(where.endsAt.value).toEqual(iranWallClockToInstant('2026-10-17', 0));
    expect(exceptionsFind.mock.calls[0][0].where).toMatchObject({ salonId: 'salon-1', isClosed: true });
  });

  it('computes days and totals from the salon capacity', async () => {
    bookingsFind.mockResolvedValue([
      { startsAt: iranWallClockToInstant('2026-10-17', 10 * 60), endsAt: iranWallClockToInstant('2026-10-17', 11 * 60) },
    ]);
    const result = await service.compute('salon-1', { from: '2026-10-17', to: '2026-10-19' }, NOW);
    expect(result.capacity).toBe(2);
    expect(result.days[0]).toMatchObject({ date: '2026-10-17', openMinutes: 480, capacityMinutes: 960, bookedMinutes: 60 });
    expect(result.days[1]).toMatchObject({ date: '2026-10-18', closedReason: 'no_hours', freePercent: null });
    expect(result.totals).toEqual({
      openMinutes: 480,
      capacityMinutes: 960,
      bookedMinutes: 60,
      freeMinutes: 900,
      freePercent: 94,
    });
  });

  it('returns a null total freePercent when nothing is on offer in the whole window', async () => {
    hoursFind.mockResolvedValue([]);
    const result = await service.compute('salon-1', { from: '2026-10-17', to: '2026-10-18' }, NOW);
    expect(result.totals.freePercent).toBeNull();
  });

  it('applies a whole-day exception from schedule_exceptions', async () => {
    exceptionsFind.mockResolvedValue([{ date: '2026-10-17', startTime: null, endTime: null }]);
    const result = await service.compute('salon-1', { from: '2026-10-17', to: '2026-10-18' }, NOW);
    expect(result.days[0].closedReason).toBe('closed_exception');
  });

  it('rejects an empty/reversed window and a window over 31 days, before touching the DB', async () => {
    await expect(service.compute('salon-1', { from: '2026-10-17', to: '2026-10-17' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.compute('salon-1', { from: '2026-10-18', to: '2026-10-17' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.compute('salon-1', { from: '2026-10-01', to: '2026-11-02' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(salonFind).not.toHaveBeenCalled();
  });

  it('accepts exactly 31 days', async () => {
    const result = await service.compute('salon-1', { from: '2026-10-01', to: '2026-11-01' }, NOW);
    expect(result.days).toHaveLength(31);
  });

  it('404s when the salon row is gone', async () => {
    salonFind.mockResolvedValue(null);
    await expect(service.compute('salon-1', {}, NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});
