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
import { PaymentsService } from './payments.service';
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
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn() } },
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

describe('BookingsService.cancel', () => {
  let service: BookingsService;
  let bookingsFindOneBy: jest.Mock;
  let salonsFindOneBy: jest.Mock;
  let emUpdate: jest.Mock;
  let attemptRefund: jest.Mock;

  const BOOKING = {
    id: 'booking-1',
    userId: 'customer-1',
    salonId: 'salon-1',
    status: 'confirmed',
    startsAt: new Date(Date.now() + 48 * 60 * 60_000), // 48h out -- outside the 24h window
  };

  beforeEach(async () => {
    emUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    attemptRefund = jest.fn().mockResolvedValue('refunded');
    bookingsFindOneBy = jest.fn();
    salonsFindOneBy = jest.fn().mockResolvedValue({ id: 'salon-1', ownerId: 'owner-1' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: { findOneBy: salonsFindOneBy } },
        { provide: getRepositoryToken(SalonService), useValue: {} },
        { provide: DataSource, useValue: { transaction: jest.fn((cb: (em: unknown) => unknown) => cb({ update: emUpdate })) } },
        {
          provide: PlatformConfigService,
          useValue: { getCancellationWindowHours: jest.fn().mockResolvedValue(24) },
        },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund } },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it('marks the payment refund_pending (with refundRequestedAt) and attempts the refund inline on an owner cancel', async () => {
    // findOneBy is called once pre-transaction and once for the returned row
    bookingsFindOneBy.mockResolvedValue({ ...BOOKING });

    await service.cancel('booking-1', 'owner-1');

    expect(emUpdate).toHaveBeenCalledWith(
      Payment,
      { bookingId: 'booking-1' },
      expect.objectContaining({ status: 'refund_pending', refundRequestedAt: expect.any(Date) }),
    );
    expect(attemptRefund).toHaveBeenCalledWith('booking-1');
  });

  it('does not attempt a refund when the customer cancels inside the window (deposit forfeited)', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...BOOKING, startsAt: new Date(Date.now() + 2 * 60 * 60_000) });

    await service.cancel('booking-1', 'customer-1');

    expect(emUpdate).toHaveBeenCalledWith(Payment, { bookingId: 'booking-1' }, { status: 'paid' });
    expect(attemptRefund).not.toHaveBeenCalled();
  });

  it('does not attempt a refund for a pending_payment booking (nothing was captured)', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...BOOKING, status: 'pending_payment' });

    await service.cancel('booking-1', 'customer-1');

    expect(emUpdate).toHaveBeenCalledWith(Payment, { bookingId: 'booking-1' }, { status: 'failed' });
    expect(attemptRefund).not.toHaveBeenCalled();
  });

  it('still succeeds the cancel when the inline refund attempt reports pending', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...BOOKING });
    attemptRefund.mockResolvedValue('pending');

    const result = await service.cancel('booking-1', 'owner-1');

    expect(result).toBeDefined();
  });
});
