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
