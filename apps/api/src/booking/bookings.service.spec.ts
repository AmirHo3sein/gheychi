import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { CouponsService } from '../coupons/coupons.service';
import { REDIS } from '../redis/redis.module';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { ReferralsService } from '../referrals/referrals.service';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Booking } from './booking.entity';
import { Payment } from './payment.entity';
import { BookingsService } from './bookings.service';
import { PaymentsService } from './payments.service';
import { Salon } from '../salons/salon.entity';
import { SalonService } from '../salons/salon-service.entity';
import { Worker } from '../salons/worker.entity';

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
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: PlatformConfigService, useValue: { getCommissionPercent: jest.fn().mockResolvedValue(10) } },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn() } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: { resolveAndValidate: jest.fn() } },
        { provide: ReferralsService, useValue: { tryGrantReward: jest.fn().mockResolvedValue(undefined) } },
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
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: DataSource, useValue: { transaction: jest.fn((cb: (em: unknown) => unknown) => cb({ update: emUpdate })) } },
        {
          provide: PlatformConfigService,
          useValue: { getCancellationWindowHours: jest.fn().mockResolvedValue(24) },
        },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: { resolveAndValidate: jest.fn() } },
        { provide: ReferralsService, useValue: { tryGrantReward: jest.fn().mockResolvedValue(undefined) } },
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

    // The 'initiated' guard means a payment that progressed past initiated (a
    // callback captured money mid-cancel) is never clobbered to 'failed'.
    expect(emUpdate).toHaveBeenCalledWith(Payment, { bookingId: 'booking-1', status: 'initiated' }, { status: 'failed' });
    expect(attemptRefund).not.toHaveBeenCalled();
  });

  it('still succeeds the cancel when the inline refund attempt reports pending', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...BOOKING });
    attemptRefund.mockResolvedValue('pending');

    const result = await service.cancel('booking-1', 'owner-1');

    expect(result).toBeDefined();
  });

  it('still succeeds the cancel when the inline refund attempt throws (cancellation is already committed)', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...BOOKING });
    attemptRefund.mockRejectedValue(new Error('transient DB failure'));

    const result = await service.cancel('booking-1', 'owner-1');

    expect(result).toBeDefined();
    expect(attemptRefund).toHaveBeenCalledWith('booking-1');
  });
});

describe('BookingsService.retryPayment authority persist failure', () => {
  let service: BookingsService;
  let bookingsFindOneBy: jest.Mock;
  let salonsFindOneBy: jest.Mock;
  let paymentsUpdate: jest.Mock;
  let requestPayment: jest.Mock;
  let raise: jest.Mock;

  beforeEach(async () => {
    bookingsFindOneBy = jest.fn().mockResolvedValue({
      id: 'booking-1',
      userId: 'customer-1',
      salonId: 'salon-1',
      status: 'pending_payment',
      depositAmount: 100_000,
    });
    salonsFindOneBy = jest.fn().mockResolvedValue({ id: 'salon-1', name: 'Test Salon', ownerId: 'owner-1' });
    paymentsUpdate = jest.fn().mockRejectedValue(new Error('db down'));
    requestPayment = jest.fn().mockResolvedValue({ authority: 'AUTH-NEW', paymentUrl: 'https://pay.example/AUTH-NEW' });
    raise = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: getRepositoryToken(Payment), useValue: { update: paymentsUpdate } },
        { provide: getRepositoryToken(Salon), useValue: { findOneBy: salonsFindOneBy } },
        { provide: getRepositoryToken(SalonService), useValue: {} },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: PlatformConfigService, useValue: {} },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn().mockReturnValue('http://localhost:3002') } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: { requestPayment } },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn() } },
        { provide: AlertsService, useValue: { raise } },
        { provide: CouponsService, useValue: { resolveAndValidate: jest.fn() } },
        { provide: ReferralsService, useValue: { tryGrantReward: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it('raises a critical alert when persisting a fresh Zarinpal authority fails (orphaned chargeable session)', async () => {
    await expect(service.retryPayment('customer-1', 'booking-1')).rejects.toThrow('db down');

    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'authority-persist:booking-1', severity: 'critical' }),
    );
  });
});

describe('BookingsService.assignWorker', () => {
  let service: BookingsService;
  let workersFindOneBy: jest.Mock;
  let workersFind: jest.Mock;
  let bookingsFindOneBy: jest.Mock;
  let bookingsUpdate: jest.Mock;

  beforeEach(async () => {
    workersFindOneBy = jest.fn();
    // attachNames() enriches the returned booking with workerName -- see
    // BookingsService.assignWorker, which now mirrors listMine/findMine's
    // enrichment so the provider-panel's assign-worker response actually carries
    // the name it expects.
    workersFind = jest.fn().mockResolvedValue([{ id: 'worker-1', name: 'Sara' }]);
    bookingsFindOneBy = jest.fn();
    bookingsUpdate = jest.fn().mockResolvedValue({ affected: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy, update: bookingsUpdate } },
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(SalonService), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Worker), useValue: { findOneBy: workersFindOneBy, find: workersFind } },
        { provide: DataSource, useValue: {} },
        { provide: PlatformConfigService, useValue: {} },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn() } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: { resolveAndValidate: jest.fn() } },
        { provide: ReferralsService, useValue: { tryGrantReward: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it('404s when the worker does not belong to the caller salon', async () => {
    workersFindOneBy.mockResolvedValue(null);

    await expect(service.assignWorker('salon-1', 'booking-1', 'worker-9')).rejects.toBeInstanceOf(NotFoundException);
    expect(workersFindOneBy).toHaveBeenCalledWith({ id: 'worker-9', salonId: 'salon-1' });
    expect(bookingsFindOneBy).not.toHaveBeenCalled();
    expect(bookingsUpdate).not.toHaveBeenCalled();
  });

  it('400s when the worker belongs to the salon but is inactive', async () => {
    workersFindOneBy.mockResolvedValue({ id: 'worker-1', salonId: 'salon-1', active: false });

    await expect(service.assignWorker('salon-1', 'booking-1', 'worker-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(bookingsUpdate).not.toHaveBeenCalled();
  });

  it('404s when the booking does not belong to the caller salon', async () => {
    workersFindOneBy.mockResolvedValue({ id: 'worker-1', salonId: 'salon-1', active: true });
    bookingsFindOneBy.mockResolvedValueOnce(null);

    await expect(service.assignWorker('salon-1', 'booking-9', 'worker-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(bookingsUpdate).not.toHaveBeenCalled();
  });

  it('assigns the worker to the booking when both belong to the caller salon and the worker is active', async () => {
    workersFindOneBy.mockResolvedValue({ id: 'worker-1', salonId: 'salon-1', active: true });
    bookingsFindOneBy
      .mockResolvedValueOnce({ id: 'booking-1', salonId: 'salon-1' })
      .mockResolvedValueOnce({ id: 'booking-1', salonId: 'salon-1', workerId: 'worker-1' });

    const result = await service.assignWorker('salon-1', 'booking-1', 'worker-1');

    expect(bookingsUpdate).toHaveBeenCalledWith({ id: 'booking-1' }, { workerId: 'worker-1' });
    expect(result.workerId).toBe('worker-1');
    expect(result.workerName).toBe('Sara');
  });
});

describe('BookingsService.listMine / findMine -- workerName enrichment', () => {
  let service: BookingsService;
  let bookingsFind: jest.Mock;
  let bookingsFindOneBy: jest.Mock;
  let salonsFind: jest.Mock;
  let servicesFind: jest.Mock;
  let workersFind: jest.Mock;
  let paymentsFindOneBy: jest.Mock;

  beforeEach(async () => {
    bookingsFind = jest.fn();
    bookingsFindOneBy = jest.fn();
    salonsFind = jest.fn().mockResolvedValue([{ id: 'salon-1', name: 'Salon One' }]);
    servicesFind = jest.fn().mockResolvedValue([{ id: 'service-1', name: 'Cut' }]);
    workersFind = jest.fn().mockResolvedValue([{ id: 'worker-1', name: 'Sara' }]);
    paymentsFindOneBy = jest.fn().mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: { find: bookingsFind, findOneBy: bookingsFindOneBy } },
        { provide: getRepositoryToken(Payment), useValue: { findOneBy: paymentsFindOneBy } },
        { provide: getRepositoryToken(Salon), useValue: { find: salonsFind } },
        { provide: getRepositoryToken(SalonService), useValue: { find: servicesFind } },
        { provide: getRepositoryToken(Worker), useValue: { find: workersFind } },
        { provide: DataSource, useValue: {} },
        { provide: PlatformConfigService, useValue: {} },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn() } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: { resolveAndValidate: jest.fn() } },
        { provide: ReferralsService, useValue: { tryGrantReward: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it('resolves workerName for a booking with a worker assigned', async () => {
    bookingsFind.mockResolvedValue([
      { id: 'booking-1', salonId: 'salon-1', serviceId: 'service-1', workerId: 'worker-1' },
    ]);

    const [result] = await service.listMine('customer-1');

    expect(workersFind).toHaveBeenCalled();
    expect(result.workerName).toBe('Sara');
  });

  it('leaves workerName null and skips the worker lookup entirely for a booking with no worker', async () => {
    bookingsFind.mockResolvedValue([{ id: 'booking-1', salonId: 'salon-1', serviceId: 'service-1', workerId: null }]);

    const [result] = await service.listMine('customer-1');

    expect(workersFind).not.toHaveBeenCalled();
    expect(result.workerName).toBeNull();
  });
});

describe('BookingsService.updateStatus -- first-completed-booking referral trigger', () => {
  let service: BookingsService;
  let bookingsFindOneBy: jest.Mock;
  let bookingsUpdate: jest.Mock;
  let tryGrantReward: jest.Mock;

  const CONFIRMED_BOOKING = { id: 'booking-1', userId: 'customer-1', salonId: 'salon-1', status: 'confirmed' };

  beforeEach(async () => {
    bookingsFindOneBy = jest.fn().mockResolvedValue({ ...CONFIRMED_BOOKING });
    bookingsUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    tryGrantReward = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy, update: bookingsUpdate } },
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: getRepositoryToken(SalonService), useValue: {} },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: PlatformConfigService, useValue: {} },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn() } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: { resolveAndValidate: jest.fn() } },
        { provide: ReferralsService, useValue: { tryGrantReward } },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it("calls tryGrantReward('completed') after successfully marking a booking completed", async () => {
    await service.updateStatus('salon-1', 'booking-1', 'completed');

    expect(tryGrantReward).toHaveBeenCalledWith('customer-1', 'booking-1', 'completed');
  });

  it('does NOT call tryGrantReward for a no_show -- only completed is a qualifying event', async () => {
    await service.updateStatus('salon-1', 'booking-1', 'no_show');

    expect(tryGrantReward).not.toHaveBeenCalled();
  });

  it('still returns the updated booking even when tryGrantReward throws (never fails the status update response)', async () => {
    tryGrantReward.mockRejectedValue(new Error('referral granting blew up'));

    const result = await service.updateStatus('salon-1', 'booking-1', 'completed');

    expect(result).toBeDefined();
    expect(tryGrantReward).toHaveBeenCalled();
  });
});
