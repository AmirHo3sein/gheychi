import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { CouponRedemption } from '../coupons/coupon-redemption.entity';
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

describe('BookingsService.createHold -- deposit is capped at the price being charged', () => {
  let service: BookingsService;
  let emCount: jest.Mock;
  let emSave: jest.Mock;
  let requestPayment: jest.Mock;
  let notifyConfirmed: jest.Mock;
  let resolveAndValidate: jest.Mock;
  let redisSet: jest.Mock;
  let redisDel: jest.Mock;

  // Cheap enough that the live config's 200,000-toman minimum would otherwise exceed it.
  const SERVICE = {
    id: 'service-1',
    salonId: 'salon-1',
    price: 150_000,
    durationMin: 30,
    discountPercent: null as number | null,
    isActive: true,
  };
  const DTO = { salonId: 'salon-1', serviceId: 'service-1', startsAt: new Date(Date.now() + 86_400_000).toISOString() };

  function savedBooking(): Record<string, unknown> {
    return emSave.mock.calls.find(([entity]) => entity === Booking)![1] as Record<string, unknown>;
  }

  beforeEach(async () => {
    emCount = jest.fn().mockResolvedValue(0);
    emSave = jest.fn(async (entity: unknown, obj: Record<string, unknown>) => ({
      id: entity === Payment ? 'pay-1' : 'booking-1',
      ...obj,
    }));
    requestPayment = jest.fn().mockResolvedValue({ authority: 'AUTH-1', paymentUrl: 'https://pay.example/AUTH-1' });
    notifyConfirmed = jest.fn().mockResolvedValue(undefined);
    resolveAndValidate = jest.fn();
    redisSet = jest.fn().mockResolvedValue('OK');
    redisDel = jest.fn().mockResolvedValue(1);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: {} },
        { provide: getRepositoryToken(Payment), useValue: {} },
        {
          provide: getRepositoryToken(Salon),
          useValue: { findOneBy: jest.fn().mockResolvedValue({ id: 'salon-1', name: 'Test Salon', capacity: 1 }) },
        },
        { provide: getRepositoryToken(SalonService), useValue: { findOneBy: jest.fn().mockResolvedValue({ ...SERVICE }) } },
        { provide: getRepositoryToken(Worker), useValue: {} },
        {
          provide: DataSource,
          useValue: {
            // Serves both the createHold transaction and createPaymentSession's own.
            transaction: jest.fn((cb: (em: unknown) => unknown) =>
              cb({ count: emCount, create: (_e: unknown, obj: unknown) => obj, save: emSave, update: jest.fn(), query: jest.fn() }),
            ),
          },
        },
        {
          provide: PlatformConfigService,
          useValue: {
            getDepositPercent: jest.fn().mockResolvedValue(20),
            getDepositMinToman: jest.fn().mockResolvedValue(200_000),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockReturnValue('http://localhost:3002'),
            get: jest.fn().mockReturnValue('http://front.example'),
          },
        },
        { provide: REDIS, useValue: { set: redisSet, del: redisDel } },
        { provide: PAYMENT_GATEWAY, useValue: { requestPayment } },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn(), notifyConfirmed } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: { resolveAndValidate } },
        { provide: ReferralsService, useValue: { tryGrantReward: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it('charges the whole price rather than the higher configured minimum on a cheap service', async () => {
    const result = await service.createHold('customer-1', DTO);

    // 20% of 150,000 is 30,000 and the minimum is 200,000 -- the price is the ceiling.
    expect(savedBooking().depositAmount).toBe(150_000);
    expect(savedBooking().status).toBe('pending_payment');
    expect(requestPayment).toHaveBeenCalledWith(150_000, expect.any(String), expect.any(String));
    expect(result.paymentRequired).toBe(true);
    expect(result.paymentUrl).toBe('https://pay.example/AUTH-1');
  });

  it('confirms a fully-discounted booking outright: no deposit, no Payment row, no gateway session', async () => {
    resolveAndValidate.mockResolvedValue({ id: 'coupon-1', discountPercent: 100, discountFixedAmount: null });

    const result = await service.createHold('customer-1', { ...DTO, couponCode: 'FREE100' });

    expect(savedBooking().depositAmount).toBe(0);
    expect(savedBooking().priceSnapshot).toBe(0);
    // Confirmed inside the transaction -- there is no payment to wait for, and a
    // pending_payment hold would just expire and release the slot.
    expect(savedBooking().status).toBe('confirmed');
    // No Payment row: a missing payment is already every reader's "nothing was captured".
    expect(emSave).not.toHaveBeenCalledWith(Payment, expect.anything());
    // Never send a customer to a payment gateway for 0 toman (Zarinpal rejects it outright,
    // which would 500 the booking request).
    expect(requestPayment).not.toHaveBeenCalled();
    // The salon still has to be told about the booking.
    expect(notifyConfirmed).toHaveBeenCalledWith('booking-1');
    expect(result.paymentRequired).toBe(false);
    expect(result.couponApplied).toBe(true);
    // Deliberately the booking page, not /booking/callback -- that page's success copy
    // claims the deposit was received, which would be untrue here.
    expect(result.paymentUrl).toBe('http://front.example/bookings/booking-1');
    expect(redisDel).toHaveBeenCalled(); // the per-salon lock is still released
  });

  it('still returns the confirmed free booking when the confirmation notification fails', async () => {
    resolveAndValidate.mockResolvedValue({ id: 'coupon-1', discountPercent: 100, discountFixedAmount: null });
    notifyConfirmed.mockRejectedValue(new Error('sms provider down'));

    const result = await service.createHold('customer-1', { ...DTO, couponCode: 'FREE100' });

    // The booking is already committed; failing the request would invite a double-book.
    expect(result.booking.id).toBe('booking-1');
    expect(result.paymentRequired).toBe(false);
  });
});

describe('BookingsService.cancel', () => {
  let service: BookingsService;
  let bookingsFindOneBy: jest.Mock;
  let salonsFindOneBy: jest.Mock;
  let emUpdate: jest.Mock;
  let emDelete: jest.Mock;
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
    emDelete = jest.fn().mockResolvedValue({ affected: 0 });
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
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((cb: (em: unknown) => unknown) => cb({ update: emUpdate, delete: emDelete })),
          },
        },
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
    // Nothing was captured, so the coupon code the hold consumed is handed back --
    // cancelling before paying must not burn it for life.
    expect(emDelete).toHaveBeenCalledWith(CouponRedemption, expect.objectContaining({ bookingId: expect.anything() }));
  });

  it('does NOT release the coupon redemption when the deposit was actually captured', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...BOOKING }); // confirmed -> deposit captured

    await service.cancel('booking-1', 'owner-1');

    expect(emDelete).not.toHaveBeenCalled();
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
  let authoritiesInsert: jest.Mock;
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
    // The authority write and its append-only payment_authorities companion run in one
    // transaction; this mock fails the payments.authority update inside it.
    paymentsUpdate = jest.fn().mockRejectedValue(new Error('db down'));
    authoritiesInsert = jest.fn().mockResolvedValue(undefined);
    requestPayment = jest.fn().mockResolvedValue({ authority: 'AUTH-NEW', paymentUrl: 'https://pay.example/AUTH-NEW' });
    raise = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: { findOneBy: salonsFindOneBy } },
        { provide: getRepositoryToken(SalonService), useValue: {} },
        { provide: getRepositoryToken(Worker), useValue: {} },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((cb: (em: unknown) => unknown) => cb({ update: paymentsUpdate, query: authoritiesInsert })),
          },
        },
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
