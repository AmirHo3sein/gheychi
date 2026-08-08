import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Salon } from '../salons/salon.entity';
import { SalonService } from '../salons/salon-service.entity';
import { ScheduleException } from '../salons/schedule-exception.entity';
import { WorkerEligibilityService } from '../salons/worker-eligibility.service';
import { WorkingHour } from '../salons/working-hour.entity';
import { AvailabilityService } from './availability.service';
import { Booking } from './booking.entity';

describe('AvailabilityService -- worker/service eligibility', () => {
  let service: AvailabilityService;
  let hoursFind: jest.Mock;
  let isWorkerEligibleForService: jest.Mock;

  const SALON = { id: 'salon-1', status: 'approved', capacity: 1 };
  const SERVICE = { id: 'service-1', salonId: 'salon-1', isActive: true, durationMin: 30 };

  beforeEach(async () => {
    // Open every day, midnight-to-midnight, so a genuine (non-eligibility) reason for
    // zero slots never masks what these tests are actually asserting.
    hoursFind = jest.fn().mockResolvedValue(
      Array.from({ length: 7 }, (_, weekday) => ({ weekday, openTime: '00:00', closeTime: '23:59' })),
    );
    // Default: the worker is unrestricted (eligible for every service).
    isWorkerEligibleForService = jest.fn().mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AvailabilityService,
        { provide: getRepositoryToken(Salon), useValue: { findOneBy: jest.fn().mockResolvedValue(SALON) } },
        { provide: getRepositoryToken(SalonService), useValue: { findOneBy: jest.fn().mockResolvedValue(SERVICE) } },
        { provide: getRepositoryToken(WorkingHour), useValue: { find: hoursFind } },
        { provide: getRepositoryToken(ScheduleException), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Booking), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: WorkerEligibilityService, useValue: { isWorkerEligibleForService } },
      ],
    }).compile();

    service = moduleRef.get(AvailabilityService);
  });

  it('never queries eligibility when no worker is requested', async () => {
    const result = await service.computeFor('salon-1', 'service-1');

    expect(isWorkerEligibleForService).not.toHaveBeenCalled();
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns real slots for a worker with no restrictions', async () => {
    const result = await service.computeFor('salon-1', 'service-1', new Date(), 'worker-1');

    expect(isWorkerEligibleForService).toHaveBeenCalledWith('worker-1', 'service-1');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns no availability at all for a worker restricted away from this service', async () => {
    isWorkerEligibleForService.mockResolvedValue(false);

    const result = await service.computeFor('salon-1', 'service-1', new Date(), 'worker-1');

    expect(result).toEqual([]);
    expect(hoursFind).not.toHaveBeenCalled();
  });
});

describe('AvailabilityService -- schedule_exceptions mapping', () => {
  const SALON = { id: 'salon-1', status: 'approved', capacity: 1 };
  const SERVICE = { id: 'service-1', salonId: 'salon-1', isActive: true, durationMin: 30 };

  // Fixed "now" so the tomorrow-onward window below is deterministic regardless of when
  // this suite runs, and both exception dates land inside the 14-day availability window.
  const NOW = new Date('2026-08-03T02:00:00.000Z'); // 05:30 Iran, Monday 2026-08-03

  async function buildService(exceptionRows: unknown[]) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AvailabilityService,
        { provide: getRepositoryToken(Salon), useValue: { findOneBy: jest.fn().mockResolvedValue(SALON) } },
        { provide: getRepositoryToken(SalonService), useValue: { findOneBy: jest.fn().mockResolvedValue(SERVICE) } },
        {
          provide: getRepositoryToken(WorkingHour),
          useValue: {
            find: jest.fn().mockResolvedValue([
              { weekday: 1, openTime: '09:00', closeTime: '12:00' },
              { weekday: 2, openTime: '09:00', closeTime: '12:00' },
            ]),
          },
        },
        { provide: getRepositoryToken(ScheduleException), useValue: { find: jest.fn().mockResolvedValue(exceptionRows) } },
        { provide: getRepositoryToken(Booking), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: WorkerEligibilityService, useValue: {} },
      ],
    }).compile();
    return moduleRef.get<AvailabilityService>(AvailabilityService);
  }

  it('excludes a whole-day exception row (both time columns null) entirely', async () => {
    const service = await buildService([{ date: '2026-08-03', startTime: null, endTime: null }]);
    const result = await service.computeFor('salon-1', 'service-1', NOW);
    expect(result.find((d) => d.date === '2026-08-03')).toBeUndefined();
  });

  it('narrows a day to around a partial-day exception row instead of excluding it entirely', async () => {
    const service = await buildService([{ date: '2026-08-03', startTime: '09:00', endTime: '10:00' }]);
    const result = await service.computeFor('salon-1', 'service-1', NOW);
    const day = result.find((d) => d.date === '2026-08-03');
    // Monday's 09:00-12:00 range minus the 09:00-10:00 exception still leaves slots after it.
    expect(day).toBeDefined();
    expect(day!.slots.length).toBeGreaterThan(0);
  });
});

describe('AvailabilityService -- per-worker time off', () => {
  const SALON = { id: 'salon-1', status: 'approved', capacity: 3 };
  const SERVICE = { id: 'service-1', salonId: 'salon-1', isActive: true, durationMin: 30 };
  const NOW = new Date('2026-08-03T02:00:00.000Z'); // 05:30 Iran, Monday 2026-08-03

  // computeFor issues the whole-salon exceptions query BEFORE the per-worker one (see the
  // Promise.all array order in availability.service.ts) -- mockResolvedValueOnce chains onto
  // that same fixed order rather than trying to branch on the where-clause shape.
  async function buildService(wholeSalonRows: unknown[], workerRows: unknown[]) {
    const exceptionsFind = jest.fn()
      .mockResolvedValueOnce(wholeSalonRows)
      .mockResolvedValueOnce(workerRows);
    const moduleRef = await Test.createTestingModule({
      providers: [
        AvailabilityService,
        { provide: getRepositoryToken(Salon), useValue: { findOneBy: jest.fn().mockResolvedValue(SALON) } },
        { provide: getRepositoryToken(SalonService), useValue: { findOneBy: jest.fn().mockResolvedValue(SERVICE) } },
        {
          provide: getRepositoryToken(WorkingHour),
          useValue: { find: jest.fn().mockResolvedValue([{ weekday: 1, openTime: '09:00', closeTime: '12:00' }]) },
        },
        { provide: getRepositoryToken(ScheduleException), useValue: { find: exceptionsFind } },
        { provide: getRepositoryToken(Booking), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: WorkerEligibilityService, useValue: { isWorkerEligibleForService: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();
    return moduleRef.get<AvailabilityService>(AvailabilityService);
  }

  it('excludes the whole day for the requested worker when they have an upcoming day off', async () => {
    const service = await buildService([], [{ date: '2026-08-03', workerId: 'worker-1', startTime: null, endTime: null }]);
    const result = await service.computeFor('salon-1', 'service-1', NOW, 'worker-1');
    expect(result.find((d) => d.date === '2026-08-03')).toBeUndefined();
  });

  it('does not affect a different worker\'s own availability', async () => {
    const service = await buildService([], [{ date: '2026-08-03', workerId: 'worker-1', startTime: null, endTime: null }]);
    const result = await service.computeFor('salon-1', 'service-1', NOW, 'worker-2');
    expect(result.find((d) => d.date === '2026-08-03')).toBeDefined();
  });

  it('does not affect "any available worker" mode -- a colleague can still take the slot', async () => {
    const service = await buildService([], [{ date: '2026-08-03', workerId: 'worker-1', startTime: null, endTime: null }]);
    const result = await service.computeFor('salon-1', 'service-1', NOW);
    expect(result.find((d) => d.date === '2026-08-03')).toBeDefined();
  });

  it('a per-worker row never closes the whole salon for a different/no requested worker', async () => {
    // Whole-salon exceptions come back empty; only the per-worker query has a row -- if
    // computeFor mixed the two queries up, this date would wrongly disappear for everyone.
    const service = await buildService([], [{ date: '2026-08-03', workerId: 'worker-1', startTime: null, endTime: null }]);
    const result = await service.computeFor('salon-1', 'service-1', NOW);
    const day = result.find((d) => d.date === '2026-08-03');
    expect(day).toBeDefined();
    expect(day!.slots.length).toBeGreaterThan(0);
  });
});
