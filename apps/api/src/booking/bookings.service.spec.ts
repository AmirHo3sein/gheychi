import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { REDIS } from '../redis/redis.module';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Booking } from './booking.entity';
import { Payment } from './payment.entity';
import { BookingsService } from './bookings.service';
import { Salon } from '../salons/salon.entity';
import { SalonService } from '../salons/salon-service.entity';

describe('BookingsService.getEarnings', () => {
  let service: BookingsService;
  let paymentsFind: jest.Mock;

  beforeEach(async () => {
    paymentsFind = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        // getEarnings() first lists the salon's booking ids (Payment has no ORM relation to
        // Booking, just a raw bookingId column) before filtering payments by those ids, so the
        // Booking repo mock needs a `find` stub too -- an empty `{}` mock throws
        // "this.bookings.find is not a function" once getEarnings() is implemented.
        { provide: getRepositoryToken(Booking), useValue: { find: jest.fn().mockResolvedValue([{ id: 'booking-1' }, { id: 'booking-2' }]) } },
        { provide: getRepositoryToken(Payment), useValue: { find: paymentsFind } },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: getRepositoryToken(SalonService), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: PlatformConfigService, useValue: { getCommissionPercent: jest.fn().mockResolvedValue(10) } },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it('sums paid payments for the salon and deducts commission', async () => {
    paymentsFind.mockResolvedValue([
      { amount: 100_000, status: 'paid' },
      { amount: 200_000, status: 'paid' },
    ]);

    const result = await service.getEarnings('salon-1');

    expect(result.totalCollected).toBe(300_000);
    expect(result.commissionPercent).toBe(10);
    expect(result.commissionAmount).toBe(30_000);
    expect(result.netPayout).toBe(270_000);
  });

  it('returns zeros when there are no paid payments yet', async () => {
    paymentsFind.mockResolvedValue([]);

    const result = await service.getEarnings('salon-1');

    expect(result).toEqual({
      totalCollected: 0,
      commissionPercent: 10,
      commissionAmount: 0,
      netPayout: 0,
    });
  });
});
