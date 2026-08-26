import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, In, LessThan, MoreThan, Not, QueryFailedError } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { UNIQUE_VIOLATION } from '../common/postgres-error-codes';
import { COUPON_ALREADY_REDEEMED } from '../coupons/coupon-error-codes';
import { CouponRedemption } from '../coupons/coupon-redemption.entity';
import { CouponsService } from '../coupons/coupons.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { MetricsService } from '../metrics/metrics.service';
import { REDIS } from '../redis/redis.module';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { ReferralsService } from '../referrals/referrals.service';
import { WalletTransaction } from '../wallet/wallet-transaction.entity';
import { WalletService } from '../wallet/wallet.service';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Booking } from './booking.entity';
import { BOOKING_UNAVAILABLE, WORKER_UNAVAILABLE } from './booking-error-codes';
import { Payment } from './payment.entity';
import { BookingsService } from './bookings.service';
import { PaymentsService } from './payments.service';
import { Salon } from '../salons/salon.entity';
import { SalonService } from '../salons/salon-service.entity';
import { Worker } from '../salons/worker.entity';
import { WorkerEligibilityService } from '../salons/worker-eligibility.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';

// Every module below satisfies BookingsService's User repository + UsersService deps (added
// for attachNames' customer-identity enrichment and createManual) the same way -- an empty
// customer list by default, overridden per-test where a specific customerName/Phone matters.
const usersRepoStub = () => ({ find: jest.fn().mockResolvedValue([]) });
const usersServiceStub = () => ({
  findOrCreateByPhone: jest.fn(),
  updateProfile: jest.fn(),
  findById: jest.fn(),
});

describe('BookingsService.getEarnings', () => {
  let service: BookingsService;
  let dataSourceQuery: jest.Mock;

  beforeEach(async () => {
    dataSourceQuery = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        MetricsService,
        { provide: getRepositoryToken(Booking), useValue: {} },
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: getRepositoryToken(SalonService), useValue: {} },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: getRepositoryToken(User), useValue: usersRepoStub() },
        { provide: UsersService, useValue: usersServiceStub() },
        { provide: AnalyticsService, useValue: { track: jest.fn().mockResolvedValue(undefined) } },
        { provide: DataSource, useValue: { query: dataSourceQuery } },
        { provide: PlatformConfigService, useValue: { getCommissionPercent: jest.fn().mockResolvedValue(10) } },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn() } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: { resolveAndValidate: jest.fn() } },
        { provide: ReferralsService, useValue: { tryGrantReward: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: WalletService,
          useValue: {
            debit: jest.fn().mockResolvedValue({ debited: 0, shortfall: 0, balanceAfter: 0, transactionId: null }),
            credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-1' }),
          },
        },
        { provide: InvoicingService, useValue: { recordCommission: jest.fn().mockResolvedValue(undefined) } },
        { provide: WorkerEligibilityService, useValue: { isWorkerEligibleForService: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it('sums the frozen financial_transactions ledger for the salon, not a live payments+rate recomputation', async () => {
    dataSourceQuery.mockResolvedValue([
      { total_collected: '300000', commission_amount: '30000', net_payout: '270000' },
    ]);

    const result = await service.getEarnings('salon-1');

    expect(result.totalCollected).toBe(300_000);
    expect(result.commissionPercent).toBe(10);
    expect(result.commissionAmount).toBe(30_000);
    expect(result.netPayout).toBe(270_000);
    expect(dataSourceQuery).toHaveBeenCalledWith(expect.stringContaining('FROM financial_transactions'), ['salon-1']);
  });

  it('returns zeros when the salon has no ledger rows yet (e.g. every booking still confirmed, none completed)', async () => {
    dataSourceQuery.mockResolvedValue([
      { total_collected: '0', commission_amount: '0', net_payout: '0' },
    ]);

    const result = await service.getEarnings('salon-1');

    expect(result).toEqual({
      totalCollected: 0,
      commissionPercent: 10,
      commissionAmount: 0,
      netPayout: 0,
    });
  });

  it('reports the CURRENT live commission rate as commissionPercent even though the ledger totals reflect an older, frozen rate', async () => {
    // The whole point of the fix: ledger totals are historically frozen and must never
    // be recomputed against the live rate. Here the ledger accrued commission at an old
    // 10% rate (10,000 on 100,000), but the platform's live rate has since moved to 15%
    // -- commissionAmount must stay exactly what was frozen, not silently become 15,000.
    dataSourceQuery.mockResolvedValue([
      { total_collected: '100000', commission_amount: '10000', net_payout: '90000' },
    ]);
    const config = { getCommissionPercent: jest.fn().mockResolvedValue(15) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        MetricsService,
        { provide: getRepositoryToken(Booking), useValue: {} },
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: getRepositoryToken(SalonService), useValue: {} },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: getRepositoryToken(User), useValue: usersRepoStub() },
        { provide: UsersService, useValue: usersServiceStub() },
        { provide: AnalyticsService, useValue: { track: jest.fn().mockResolvedValue(undefined) } },
        { provide: DataSource, useValue: { query: dataSourceQuery } },
        { provide: PlatformConfigService, useValue: config },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn() } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: { resolveAndValidate: jest.fn() } },
        { provide: ReferralsService, useValue: { tryGrantReward: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: WalletService,
          useValue: {
            debit: jest.fn().mockResolvedValue({ debited: 0, shortfall: 0, balanceAfter: 0, transactionId: null }),
            credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-1' }),
          },
        },
        { provide: InvoicingService, useValue: { recordCommission: jest.fn().mockResolvedValue(undefined) } },
        { provide: WorkerEligibilityService, useValue: { isWorkerEligibleForService: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();
    const serviceWithNewRate = moduleRef.get(BookingsService);

    const result = await serviceWithNewRate.getEarnings('salon-1');

    expect(result.commissionAmount).toBe(10_000); // untouched by the live rate change
    expect(result.commissionPercent).toBe(15); // the NEW live rate, reported as-is
  });
});

describe('BookingsService.createHold -- deposit is capped at the price being charged', () => {
  let service: BookingsService;
  let metrics: MetricsService;
  let emCount: jest.Mock;
  let emSave: jest.Mock;
  let emUpdate: jest.Mock;
  let emQuery: jest.Mock;
  let requestPayment: jest.Mock;
  let notifyConfirmed: jest.Mock;
  let resolveAndValidate: jest.Mock;
  let redisSet: jest.Mock;
  let redisEval: jest.Mock;
  let walletDebit: jest.Mock;
  let workersFindOneBy: jest.Mock;
  let analyticsTrack: jest.Mock;

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
    redisEval = jest.fn().mockResolvedValue(1);
    emUpdate = jest.fn();
    // Only used by createPaymentSession's payment_authorities insert now -- worker
    // eligibility is checked via the WorkerEligibilityService mock below instead.
    emQuery = jest.fn().mockResolvedValue(undefined);
    // Default: wallet balance is never applied unless a test opts in via
    // applyWalletBalance and overrides this to actually debit something.
    walletDebit = jest.fn().mockResolvedValue({ debited: 0, shortfall: 0, balanceAfter: 0, transactionId: null });
    workersFindOneBy = jest.fn().mockResolvedValue({ id: 'worker-1', salonId: 'salon-1', active: true });
    analyticsTrack = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        MetricsService,
        { provide: getRepositoryToken(Booking), useValue: {} },
        { provide: getRepositoryToken(Payment), useValue: {} },
        {
          provide: getRepositoryToken(Salon),
          useValue: { findOneBy: jest.fn().mockResolvedValue({ id: 'salon-1', name: 'Test Salon', capacity: 1 }) },
        },
        { provide: getRepositoryToken(SalonService), useValue: { findOneBy: jest.fn().mockResolvedValue({ ...SERVICE }) } },
        { provide: getRepositoryToken(Worker), useValue: { findOneBy: workersFindOneBy } },
        { provide: getRepositoryToken(User), useValue: usersRepoStub() },
        { provide: UsersService, useValue: usersServiceStub() },
        { provide: AnalyticsService, useValue: { track: analyticsTrack } },
        {
          provide: DataSource,
          useValue: {
            // Serves both the createHold transaction and createPaymentSession's own.
            transaction: jest.fn((cb: (em: unknown) => unknown) =>
              cb({
                count: emCount,
                create: (_e: unknown, obj: unknown) => obj,
                save: emSave,
                update: emUpdate,
                query: emQuery,
              }),
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
        { provide: REDIS, useValue: { set: redisSet, eval: redisEval } },
        { provide: PAYMENT_GATEWAY, useValue: { requestPayment } },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn(), notifyConfirmed } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: { resolveAndValidate } },
        { provide: ReferralsService, useValue: { tryGrantReward: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: WalletService,
          useValue: {
            debit: walletDebit,
            credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-1' }),
          },
        },
        { provide: InvoicingService, useValue: { recordCommission: jest.fn().mockResolvedValue(undefined) } },
        { provide: WorkerEligibilityService, useValue: { isWorkerEligibleForService: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
    metrics = moduleRef.get(MetricsService);
  });

  it('409s with BOOKING_UNAVAILABLE when the salon is already at capacity for that time', async () => {
    emCount.mockResolvedValue(1); // salon.capacity is 1

    await expect(service.createHold('customer-1', DTO)).rejects.toMatchObject({
      response: { message: 'Slot no longer available', code: BOOKING_UNAVAILABLE },
    });
  });

  it('booking_attempts_total/booking_failures_total{reason:BOOKING_UNAVAILABLE} move on a rejected attempt', async () => {
    emCount.mockResolvedValue(1); // salon.capacity is 1

    await expect(service.createHold('customer-1', DTO)).rejects.toBeDefined();

    const attempts = await metrics.registry.getSingleMetric('booking_attempts_total')?.get();
    expect(attempts?.values).toContainEqual(expect.objectContaining({ labels: { flow: 'online' }, value: 1 }));
    const failures = await metrics.registry.getSingleMetric('booking_failures_total')?.get();
    expect(failures?.values).toContainEqual(
      expect.objectContaining({ labels: { flow: 'online', reason: BOOKING_UNAVAILABLE }, value: 1 }),
    );
    const successes = await metrics.registry.getSingleMetric('booking_successes_total')?.get();
    expect(successes?.values).toEqual([]);
  });

  it('booking_attempts_total/booking_successes_total move on a genuinely successful createHold', async () => {
    await service.createHold('customer-1', DTO);

    const attempts = await metrics.registry.getSingleMetric('booking_attempts_total')?.get();
    expect(attempts?.values).toContainEqual(expect.objectContaining({ labels: { flow: 'online' }, value: 1 }));
    const successes = await metrics.registry.getSingleMetric('booking_successes_total')?.get();
    expect(successes?.values).toContainEqual(expect.objectContaining({ labels: { flow: 'online' }, value: 1 }));
  });

  it('409s with BOOKING_UNAVAILABLE, without opening a transaction, when the per-salon lock is already held', async () => {
    redisSet.mockResolvedValueOnce(null); // NX failed -- someone else holds the lock

    await expect(service.createHold('customer-1', DTO)).rejects.toMatchObject({
      response: { message: 'This slot is being booked by someone else, try again', code: BOOKING_UNAVAILABLE },
    });
  });

  it('charges the whole price rather than the higher configured minimum on a cheap service', async () => {
    const result = await service.createHold('customer-1', DTO);

    // 20% of 150,000 is 30,000 and the minimum is 200,000 -- the price is the ceiling.
    expect(savedBooking().depositAmount).toBe(150_000);
    expect(savedBooking().status).toBe('pending_payment');
    expect(requestPayment).toHaveBeenCalledWith(150_000, expect.any(String), expect.any(String));
    expect(result.paymentRequired).toBe(true);
    expect(result.paymentUrl).toBe('https://pay.example/AUTH-1');
    // No applyWalletBalance in the request -- the wallet must never be touched.
    expect(walletDebit).not.toHaveBeenCalled();
  });

  it('partially covers the deposit with wallet balance and charges only the remainder online', async () => {
    walletDebit.mockResolvedValue({ debited: 50_000, shortfall: 0, balanceAfter: 0, transactionId: 'wt-1' });

    const result = await service.createHold('customer-1', { ...DTO, applyWalletBalance: true });

    // debit() is asked for the FULL pre-wallet deposit (150,000) -- it caps at the
    // customer's real balance itself, so createHold doesn't need to know the balance
    // up front, only the ceiling it would accept.
    expect(walletDebit).toHaveBeenCalledWith(
      expect.anything(),
      'customer-1',
      'toman',
      150_000,
      'booking_spend',
      expect.objectContaining({ referenceType: 'booking' }),
    );
    expect(savedBooking().walletAmountUsed).toBe(50_000);
    // depositAmount is what's actually charged online, not the nominal pre-wallet figure.
    expect(savedBooking().depositAmount).toBe(100_000);
    expect(requestPayment).toHaveBeenCalledWith(100_000, expect.any(String), expect.any(String));
    expect(result.paymentRequired).toBe(true);
    // The wallet ledger row couldn't name the booking until after the insert produced an
    // id -- backfilled via a follow-up update keyed on the transaction id debit() returned.
    expect(emUpdate).toHaveBeenCalledWith(WalletTransaction, { id: 'wt-1' }, { referenceId: 'booking-1' });
  });

  it('confirms the booking outright when wallet balance alone covers the whole deposit -- same path as a 100%-off coupon', async () => {
    walletDebit.mockResolvedValue({ debited: 150_000, shortfall: 0, balanceAfter: 0, transactionId: 'wt-1' });

    const result = await service.createHold('customer-1', { ...DTO, applyWalletBalance: true });

    expect(savedBooking().walletAmountUsed).toBe(150_000);
    expect(savedBooking().depositAmount).toBe(0);
    expect(savedBooking().status).toBe('confirmed');
    expect(emSave).not.toHaveBeenCalledWith(Payment, expect.anything());
    expect(requestPayment).not.toHaveBeenCalled();
    expect(notifyConfirmed).toHaveBeenCalledWith('booking-1');
    expect(result.paymentRequired).toBe(false);
  });

  it('does not touch the wallet when the deposit is already 0 before any wallet credit is considered', async () => {
    resolveAndValidate.mockResolvedValue({ id: 'coupon-1', discountPercent: 100, discountFixedAmount: null });

    await service.createHold('customer-1', { ...DTO, couponCode: 'FREE100', applyWalletBalance: true });

    // Nothing to reduce -- debit() must never be called against a zero deposit.
    expect(walletDebit).not.toHaveBeenCalled();
    expect(savedBooking().walletAmountUsed).toBeNull();
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
    expect(redisEval).toHaveBeenCalled(); // the per-salon lock is still released
  });

  it('still returns the confirmed free booking when the confirmation notification fails', async () => {
    resolveAndValidate.mockResolvedValue({ id: 'coupon-1', discountPercent: 100, discountFixedAmount: null });
    notifyConfirmed.mockRejectedValue(new Error('sms provider down'));

    const result = await service.createHold('customer-1', { ...DTO, couponCode: 'FREE100' });

    // The booking is already committed; failing the request would invite a double-book.
    expect(result.booking.id).toBe('booking-1');
    expect(result.paymentRequired).toBe(false);
  });

  // resolveAndValidate's own already-used check is a best-effort pre-check that can lose
  // a genuine concurrent-request race -- UNIQUE(coupon_id, user_id) is the real backstop,
  // caught and translated at the CouponRedemption em.save() call site. This must surface
  // the exact same code as the ordinary (non-race) already-redeemed rejection above, since
  // it's the same real-world failure from a caller's point of view.
  it('translates a concurrent duplicate-redemption race into the same code as the ordinary already-redeemed rejection', async () => {
    resolveAndValidate.mockResolvedValue({ id: 'coupon-1', discountPercent: 10, discountFixedAmount: null });
    const raceErr = new QueryFailedError('query', [], new Error('duplicate key'));
    (raceErr as unknown as { code: string }).code = UNIQUE_VIOLATION;
    emSave.mockImplementation(async (entity: unknown, obj: Record<string, unknown>) => {
      if (entity === CouponRedemption) throw raceErr;
      return { id: entity === Payment ? 'pay-1' : 'booking-1', ...obj };
    });

    const promise = service.createHold('customer-1', { ...DTO, couponCode: 'WELCOME10' });
    await expect(promise).rejects.toThrow(BadRequestException);
    await expect(promise).rejects.toThrow('شما قبلا از این کد تخفیف استفاده کرده‌اید');
    await expect(promise).rejects.toMatchObject({ response: { code: COUPON_ALREADY_REDEEMED } });
  });

  describe('customer-chosen worker', () => {
    it('records the chosen worker on the booking when it is active and belongs to the salon', async () => {
      const result = await service.createHold('customer-1', { ...DTO, workerId: 'worker-1' });

      expect(workersFindOneBy).toHaveBeenCalledWith({ id: 'worker-1', salonId: 'salon-1' });
      expect(savedBooking().workerId).toBe('worker-1');
      expect(result.paymentRequired).toBe(true);
    });

    it('404s when the chosen worker does not belong to this salon', async () => {
      workersFindOneBy.mockResolvedValue(null);

      await expect(service.createHold('customer-1', { ...DTO, workerId: 'worker-9' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(emSave).not.toHaveBeenCalledWith(Booking, expect.anything());
    });

    it('400s when the chosen worker belongs to the salon but is inactive', async () => {
      workersFindOneBy.mockResolvedValue({ id: 'worker-1', salonId: 'salon-1', active: false });

      await expect(service.createHold('customer-1', { ...DTO, workerId: 'worker-1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(emSave).not.toHaveBeenCalledWith(Booking, expect.anything());
    });

    it('409s with WORKER_UNAVAILABLE when the chosen worker already has an overlapping booking, even with spare salon capacity', async () => {
      // The FIRST em.count call is the salon-wide capacity check (kept under capacity);
      // the SECOND is the per-worker overlap check, keyed on the same overlap shape.
      emCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

      await expect(service.createHold('customer-1', { ...DTO, workerId: 'worker-1' })).rejects.toMatchObject({
        response: { message: 'این کارمند در این زمان نوبت دیگری دارد', code: WORKER_UNAVAILABLE },
      });
      expect(emSave).not.toHaveBeenCalledWith(Booking, expect.anything());
    });

    it('never checks the worker repo or the per-worker overlap when no workerId is sent', async () => {
      await service.createHold('customer-1', DTO);

      expect(workersFindOneBy).not.toHaveBeenCalled();
      expect(emCount).toHaveBeenCalledTimes(1); // salon capacity only
    });
  });

  describe('analytics', () => {
    it('tracks booking_started before any validation, with no PII beyond bare id references', async () => {
      await service.createHold('customer-1', { ...DTO, workerId: 'worker-1' });

      expect(analyticsTrack).toHaveBeenCalledWith(
        'booking_started',
        { salonId: 'salon-1', serviceId: 'service-1', workerId: 'worker-1', hasCoupon: false, flow: 'online' },
        { userId: 'customer-1' },
      );
    });

    it('still creates the booking when the analytics provider fails (never affects the real booking flow)', async () => {
      analyticsTrack.mockRejectedValue(new Error('analytics vendor down'));

      const result = await service.createHold('customer-1', DTO);

      expect(result.booking.id).toBe('booking-1');
    });
  });
});

describe('BookingsService.createManual', () => {
  let service: BookingsService;
  let emCount: jest.Mock;
  let emSave: jest.Mock;
  let findOrCreateByPhone: jest.Mock;
  let updateProfile: jest.Mock;
  let notifyConfirmed: jest.Mock;
  let redisSet: jest.Mock;
  let redisEval: jest.Mock;
  let workersFindOneBy: jest.Mock;
  let isWorkerEligibleForService: jest.Mock;
  let usersFind: jest.Mock;
  let analyticsTrack: jest.Mock;

  const SALON = { id: 'salon-1', status: 'approved', capacity: 1, name: 'Test Salon' };
  const SERVICE = { id: 'service-1', salonId: 'salon-1', price: 150_000, durationMin: 30, isActive: true };
  const CUSTOMER = { id: 'customer-1', name: null as string | null, phone: '09120000000' };
  const DTO = {
    phone: '09120000000',
    serviceId: 'service-1',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
  };

  function savedBooking(): Record<string, unknown> {
    return emSave.mock.calls.find(([entity]) => entity === Booking)![1] as Record<string, unknown>;
  }

  beforeEach(async () => {
    emCount = jest.fn().mockResolvedValue(0);
    emSave = jest.fn(async (entity: unknown, obj: Record<string, unknown>) => ({ id: 'booking-1', ...obj }));
    findOrCreateByPhone = jest.fn().mockResolvedValue({ user: { ...CUSTOMER }, isNew: true });
    updateProfile = jest.fn().mockResolvedValue(undefined);
    notifyConfirmed = jest.fn().mockResolvedValue(undefined);
    redisSet = jest.fn().mockResolvedValue('OK');
    redisEval = jest.fn().mockResolvedValue(1);
    workersFindOneBy = jest.fn().mockResolvedValue({ id: 'worker-1', salonId: 'salon-1', active: true });
    isWorkerEligibleForService = jest.fn().mockResolvedValue(true);
    usersFind = jest.fn().mockResolvedValue([{ ...CUSTOMER }]);
    analyticsTrack = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        MetricsService,
        { provide: getRepositoryToken(Booking), useValue: {} },
        { provide: getRepositoryToken(Payment), useValue: {} },
        {
          provide: getRepositoryToken(Salon),
          useValue: { findOneBy: jest.fn().mockResolvedValue({ ...SALON }), find: jest.fn().mockResolvedValue([SALON]) },
        },
        {
          provide: getRepositoryToken(SalonService),
          useValue: { findOneBy: jest.fn().mockResolvedValue({ ...SERVICE }), find: jest.fn().mockResolvedValue([{ id: 'service-1', name: 'کوتاهی مو' }]) },
        },
        { provide: getRepositoryToken(Worker), useValue: { findOneBy: workersFindOneBy, find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(User), useValue: { find: usersFind } },
        { provide: UsersService, useValue: { findOrCreateByPhone, updateProfile, findById: jest.fn() } },
        { provide: AnalyticsService, useValue: { track: analyticsTrack } },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((cb: (em: unknown) => unknown) =>
              cb({ count: emCount, create: (_e: unknown, obj: unknown) => obj, save: emSave }),
            ),
          },
        },
        { provide: PlatformConfigService, useValue: {} },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn(), get: jest.fn() } },
        { provide: REDIS, useValue: { set: redisSet, eval: redisEval } },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn(), notifyConfirmed } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: {} },
        { provide: ReferralsService, useValue: {} },
        { provide: WalletService, useValue: {} },
        { provide: InvoicingService, useValue: {} },
        { provide: WorkerEligibilityService, useValue: { isWorkerEligibleForService } },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it('resolves the customer by phone, inserts a confirmed manual booking with no Payment row, and notifies', async () => {
    const result = await service.createManual('salon-1', { ...DTO });

    expect(findOrCreateByPhone).toHaveBeenCalledWith('09120000000');
    expect(savedBooking()).toMatchObject({
      userId: 'customer-1',
      salonId: 'salon-1',
      serviceId: 'service-1',
      priceSnapshot: 150_000,
      depositAmount: 0,
      status: 'confirmed',
      source: 'manual',
      notes: null,
    });
    expect(emSave).not.toHaveBeenCalledWith(Payment, expect.anything());
    expect(notifyConfirmed).toHaveBeenCalledWith('booking-1');
    expect(result.customerPhone).toBe('09120000000');
    expect(redisEval).toHaveBeenCalled();
  });

  it('sets the name on a brand-new shadow customer when one is given', async () => {
    await service.createManual('salon-1', { ...DTO, name: 'علی رضایی' });

    expect(updateProfile).toHaveBeenCalledWith('customer-1', { name: 'علی رضایی' });
  });

  it('never overwrites an existing customer\'s own name, even when a different name is typed', async () => {
    findOrCreateByPhone.mockResolvedValue({ user: { ...CUSTOMER, name: 'مشتری قدیمی' }, isNew: false });

    await service.createManual('salon-1', { ...DTO, name: 'یک اسم دیگر' });

    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('sets a name for an existing (not new) customer who never had one', async () => {
    findOrCreateByPhone.mockResolvedValue({ user: { ...CUSTOMER, name: null }, isNew: false });

    await service.createManual('salon-1', { ...DTO, name: 'مشتری بدون نام' });

    expect(updateProfile).toHaveBeenCalledWith('customer-1', { name: 'مشتری بدون نام' });
  });

  it('carries owner-authored notes onto the booking', async () => {
    await service.createManual('salon-1', { ...DTO, notes: 'تماس تلفنی' });
    expect(savedBooking().notes).toBe('تماس تلفنی');
  });

  it('409s with BOOKING_UNAVAILABLE when the salon is already at capacity for that time', async () => {
    emCount.mockResolvedValue(1); // salon.capacity is 1

    await expect(service.createManual('salon-1', { ...DTO })).rejects.toMatchObject({
      response: { message: 'این زمان قبلا پر شده است', code: BOOKING_UNAVAILABLE },
    });
    expect(emSave).not.toHaveBeenCalledWith(Booking, expect.anything());
  });

  it('409s with BOOKING_UNAVAILABLE, without opening a transaction, when the per-salon lock is already held', async () => {
    redisSet.mockResolvedValueOnce(null); // NX failed -- someone else holds the lock

    await expect(service.createManual('salon-1', { ...DTO })).rejects.toMatchObject({
      response: {
        message: 'این عملیات توسط درخواست دیگری در حال انجام است، دوباره تلاش کنید',
        code: BOOKING_UNAVAILABLE,
      },
    });
    expect(emSave).not.toHaveBeenCalledWith(Booking, expect.anything());
  });

  it('400s on a startsAt that is not a valid future date-time', async () => {
    await expect(
      service.createManual('salon-1', { ...DTO, startsAt: new Date(Date.now() - 86_400_000).toISOString() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s when the chosen worker does not belong to this salon', async () => {
    workersFindOneBy.mockResolvedValue(null);

    await expect(service.createManual('salon-1', { ...DTO, workerId: 'worker-9' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400s when the chosen worker belongs to the salon but is inactive', async () => {
    workersFindOneBy.mockResolvedValue({ id: 'worker-1', salonId: 'salon-1', active: false });

    await expect(service.createManual('salon-1', { ...DTO, workerId: 'worker-1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s when the chosen worker cannot perform this service', async () => {
    isWorkerEligibleForService.mockResolvedValue(false);

    await expect(service.createManual('salon-1', { ...DTO, workerId: 'worker-1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('409s with WORKER_UNAVAILABLE when the chosen worker already has an overlapping booking, even with spare salon capacity', async () => {
    // The FIRST em.count call is the salon-wide capacity check; the SECOND is the
    // per-worker overlap check, same shape as createHold's own equivalent test.
    emCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await expect(service.createManual('salon-1', { ...DTO, workerId: 'worker-1' })).rejects.toMatchObject({
      response: { message: 'این کارمند در این زمان نوبت دیگری دارد', code: WORKER_UNAVAILABLE },
    });
    expect(emSave).not.toHaveBeenCalledWith(Booking, expect.anything());
  });

  it('still returns the created booking when the confirmation notification fails', async () => {
    notifyConfirmed.mockRejectedValue(new Error('sms provider down'));

    const result = await service.createManual('salon-1', { ...DTO });

    expect(result.id).toBe('booking-1');
  });

  it('releases the per-salon lock even when the transaction throws', async () => {
    emCount.mockResolvedValue(1); // forces the capacity ConflictException

    await expect(service.createManual('salon-1', { ...DTO })).rejects.toBeInstanceOf(ConflictException);
    expect(redisEval).toHaveBeenCalled();
  });

  describe('analytics', () => {
    it('tracks booking_started before any validation, with no customer PII (the phone is not yet resolved to a user)', async () => {
      await service.createManual('salon-1', { ...DTO, workerId: 'worker-1' });

      expect(analyticsTrack).toHaveBeenCalledWith('booking_started', {
        salonId: 'salon-1',
        serviceId: 'service-1',
        workerId: 'worker-1',
        flow: 'manual',
      });
    });

    it('still creates the booking when the analytics provider fails (never affects the real booking flow)', async () => {
      analyticsTrack.mockRejectedValue(new Error('analytics vendor down'));

      const result = await service.createManual('salon-1', { ...DTO });

      expect(result.id).toBe('booking-1');
    });
  });
});

describe('BookingsService.cancel', () => {
  let service: BookingsService;
  let bookingsFindOneBy: jest.Mock;
  let salonsFindOneBy: jest.Mock;
  let emUpdate: jest.Mock;
  let emDelete: jest.Mock;
  let attemptRefund: jest.Mock;
  let notifyCancelled: jest.Mock;
  let analyticsTrack: jest.Mock;

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
    notifyCancelled = jest.fn().mockResolvedValue(undefined);
    bookingsFindOneBy = jest.fn();
    salonsFindOneBy = jest.fn().mockResolvedValue({ id: 'salon-1', ownerId: 'owner-1' });
    analyticsTrack = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        MetricsService,
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: { findOneBy: salonsFindOneBy } },
        { provide: getRepositoryToken(SalonService), useValue: {} },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: getRepositoryToken(User), useValue: usersRepoStub() },
        { provide: UsersService, useValue: usersServiceStub() },
        { provide: AnalyticsService, useValue: { track: analyticsTrack } },
        {
          provide: DataSource,
          useValue: {
            // find: [] -- releaseBookingHold's wallet-reversal lookup runs unconditionally
            // alongside the coupon-redemption delete; these cancel() tests don't exercise
            // wallet spend, so an empty result keeps that half a no-op, same as a booking
            // that never used its wallet.
            transaction: jest.fn((cb: (em: unknown) => unknown) =>
              cb({ update: emUpdate, delete: emDelete, find: jest.fn().mockResolvedValue([]) }),
            ),
          },
        },
        {
          provide: PlatformConfigService,
          useValue: { getCancellationWindowHours: jest.fn().mockResolvedValue(24) },
        },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund, notifyCancelled } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: { resolveAndValidate: jest.fn() } },
        { provide: ReferralsService, useValue: { tryGrantReward: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: WalletService,
          useValue: {
            debit: jest.fn().mockResolvedValue({ debited: 0, shortfall: 0, balanceAfter: 0, transactionId: null }),
            credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-1' }),
          },
        },
        { provide: InvoicingService, useValue: { recordCommission: jest.fn().mockResolvedValue(undefined) } },
        { provide: WorkerEligibilityService, useValue: { isWorkerEligibleForService: jest.fn().mockResolvedValue(true) } },
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
    // The owner did the cancelling -- they don't need to notify themselves.
    expect(notifyCancelled).toHaveBeenCalledWith('booking-1', 'salon');
  });

  it('does not attempt a refund when the customer cancels inside the window (deposit forfeited)', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...BOOKING, startsAt: new Date(Date.now() + 2 * 60 * 60_000) });

    await service.cancel('booking-1', 'customer-1');

    expect(emUpdate).toHaveBeenCalledWith(Payment, { bookingId: 'booking-1' }, { status: 'paid' });
    expect(attemptRefund).not.toHaveBeenCalled();
    // Still notifies (and this time the owner too) even though nothing is refunded --
    // "cancelled" and "refunded" are two separate, honest pieces of information.
    expect(notifyCancelled).toHaveBeenCalledWith('booking-1', 'user');
  });

  it('still cancels successfully when the notification throws (best-effort, never blocks the response)', async () => {
    bookingsFindOneBy.mockResolvedValue({ ...BOOKING });
    notifyCancelled.mockRejectedValue(new Error('sms provider down'));

    const result = await service.cancel('booking-1', 'owner-1');

    expect(result.id).toBe('booking-1');
    expect(attemptRefund).toHaveBeenCalled(); // the refund path still runs independently
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

  describe('analytics', () => {
    it('tracks booking_cancelled once cancel() has succeeded, with no PII beyond bare id references', async () => {
      bookingsFindOneBy.mockResolvedValue({ ...BOOKING });

      await service.cancel('booking-1', 'owner-1');

      expect(analyticsTrack).toHaveBeenCalledWith(
        'booking_cancelled',
        { bookingId: 'booking-1', salonId: 'salon-1', cancelledBy: 'salon', refundOwed: true },
        { userId: 'owner-1' },
      );
    });

    it('reports the customer as the canceller and no refund owed when the customer cancels inside the window', async () => {
      bookingsFindOneBy.mockResolvedValue({ ...BOOKING, startsAt: new Date(Date.now() + 2 * 60 * 60_000) });

      await service.cancel('booking-1', 'customer-1');

      expect(analyticsTrack).toHaveBeenCalledWith(
        'booking_cancelled',
        { bookingId: 'booking-1', salonId: 'salon-1', cancelledBy: 'user', refundOwed: false },
        { userId: 'customer-1' },
      );
    });

    it('still cancels successfully when the analytics provider fails (never affects the real cancellation)', async () => {
      bookingsFindOneBy.mockResolvedValue({ ...BOOKING });
      analyticsTrack.mockRejectedValue(new Error('analytics vendor down'));

      const result = await service.cancel('booking-1', 'owner-1');

      expect(result.id).toBe('booking-1');
    });
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
        MetricsService,
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: { findOneBy: salonsFindOneBy } },
        { provide: getRepositoryToken(SalonService), useValue: {} },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: getRepositoryToken(User), useValue: usersRepoStub() },
        { provide: UsersService, useValue: usersServiceStub() },
        { provide: AnalyticsService, useValue: { track: jest.fn().mockResolvedValue(undefined) } },
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
        {
          provide: WalletService,
          useValue: {
            debit: jest.fn().mockResolvedValue({ debited: 0, shortfall: 0, balanceAfter: 0, transactionId: null }),
            credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-1' }),
          },
        },
        { provide: InvoicingService, useValue: { recordCommission: jest.fn().mockResolvedValue(undefined) } },
        { provide: WorkerEligibilityService, useValue: { isWorkerEligibleForService: jest.fn().mockResolvedValue(true) } },
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
  let workersFind: jest.Mock;
  let bookingsFindOneBy: jest.Mock;
  let emFindOneBy: jest.Mock;
  let emCount: jest.Mock;
  let emUpdate: jest.Mock;
  let dataSourceTransaction: jest.Mock;
  let redisSet: jest.Mock;
  let redisEval: jest.Mock;
  let isWorkerEligibleForService: jest.Mock;

  const BOOKING = {
    id: 'booking-1',
    salonId: 'salon-1',
    serviceId: 'service-1',
    startsAt: new Date('2026-08-10T09:00:00.000Z'),
    endsAt: new Date('2026-08-10T09:30:00.000Z'),
  };
  const ACTIVE_WORKER = { id: 'worker-1', salonId: 'salon-1', active: true };

  beforeEach(async () => {
    // attachNames() enriches the returned booking with workerName -- see
    // BookingsService.assignWorker, which mirrors listMine/findMine's enrichment so the
    // provider-panel's assign-worker response actually carries the name it expects.
    workersFind = jest.fn().mockResolvedValue([{ id: 'worker-1', name: 'Sara' }]);
    bookingsFindOneBy = jest.fn().mockResolvedValue({ ...BOOKING, workerId: 'worker-1' });

    emFindOneBy = jest.fn((entity: unknown) => {
      if (entity === Worker) return Promise.resolve(ACTIVE_WORKER);
      return Promise.resolve(BOOKING);
    });
    emCount = jest.fn().mockResolvedValue(0); // default: no overlapping booking for the worker
    emUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    // Default: the worker is unrestricted (eligible for every service) unless a test
    // opts in to simulate a worker_services row via mockResolvedValueOnce.
    isWorkerEligibleForService = jest.fn().mockResolvedValue(true);
    dataSourceTransaction = jest.fn((cb: (em: unknown) => unknown) =>
      cb({ findOneBy: emFindOneBy, count: emCount, update: emUpdate }),
    );
    redisSet = jest.fn().mockResolvedValue('OK');
    redisEval = jest.fn().mockResolvedValue(1);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        MetricsService,
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(SalonService), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Worker), useValue: { find: workersFind } },
        { provide: getRepositoryToken(User), useValue: usersRepoStub() },
        { provide: UsersService, useValue: usersServiceStub() },
        { provide: AnalyticsService, useValue: { track: jest.fn().mockResolvedValue(undefined) } },
        { provide: DataSource, useValue: { transaction: dataSourceTransaction } },
        { provide: PlatformConfigService, useValue: {} },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: { set: redisSet, eval: redisEval } },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn() } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: { resolveAndValidate: jest.fn() } },
        { provide: ReferralsService, useValue: { tryGrantReward: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: WalletService,
          useValue: {
            debit: jest.fn().mockResolvedValue({ debited: 0, shortfall: 0, balanceAfter: 0, transactionId: null }),
            credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-1' }),
          },
        },
        { provide: InvoicingService, useValue: { recordCommission: jest.fn().mockResolvedValue(undefined) } },
        { provide: WorkerEligibilityService, useValue: { isWorkerEligibleForService } },
      ],
    }).compile();

    service = moduleRef.get(BookingsService);
  });

  it('409s with BOOKING_UNAVAILABLE immediately, without opening a transaction, when the per-salon lock is already held', async () => {
    redisSet.mockResolvedValueOnce(null); // NX failed -- someone else holds the lock

    await expect(service.assignWorker('salon-1', 'booking-1', 'worker-1')).rejects.toMatchObject({
      response: {
        message: 'این عملیات توسط درخواست دیگری در حال انجام است، دوباره تلاش کنید',
        code: BOOKING_UNAVAILABLE,
      },
    });
    expect(dataSourceTransaction).not.toHaveBeenCalled();
  });

  it('always releases the per-salon lock, even when the transaction throws', async () => {
    emFindOneBy.mockImplementation((entity: unknown) => Promise.resolve(entity === Worker ? null : BOOKING));

    await expect(service.assignWorker('salon-1', 'booking-1', 'worker-9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // The lock value is now a unique per-acquisition token (a UUID), never the fixed
    // '1' the old bare-DEL implementation used -- that fixed value is exactly what
    // made an unconditional DEL unable to tell its own lock apart from anyone else's.
    expect(redisSet).toHaveBeenCalledWith('lock:booking:salon-1', expect.any(String), 'PX', expect.any(Number), 'NX');
    // Release goes through the atomic Lua compare-and-delete (EVAL), never a bare DEL,
    // and is called with the exact token this same acquisition's SET call was given.
    const [, acquiredToken] = redisSet.mock.calls[0] as [string, string];
    expect(redisEval).toHaveBeenCalledWith(expect.any(String), 1, 'lock:booking:salon-1', acquiredToken);
  });

  it('404s when the worker does not belong to the caller salon', async () => {
    emFindOneBy.mockImplementation((entity: unknown) => Promise.resolve(entity === Worker ? null : BOOKING));

    await expect(service.assignWorker('salon-1', 'booking-1', 'worker-9')).rejects.toBeInstanceOf(NotFoundException);
    expect(emUpdate).not.toHaveBeenCalled();
  });

  it('400s when the worker belongs to the salon but is inactive', async () => {
    emFindOneBy.mockImplementation((entity: unknown) =>
      Promise.resolve(entity === Worker ? { ...ACTIVE_WORKER, active: false } : BOOKING),
    );

    await expect(service.assignWorker('salon-1', 'booking-1', 'worker-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(emUpdate).not.toHaveBeenCalled();
  });

  it('404s when the booking does not belong to the caller salon', async () => {
    emFindOneBy.mockImplementation((entity: unknown) => Promise.resolve(entity === Worker ? ACTIVE_WORKER : null));

    await expect(service.assignWorker('salon-1', 'booking-9', 'worker-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(emUpdate).not.toHaveBeenCalled();
  });

  it('400s when the worker is restricted away from the booking service', async () => {
    isWorkerEligibleForService.mockResolvedValueOnce(false);

    await expect(service.assignWorker('salon-1', 'booking-1', 'worker-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(emUpdate).not.toHaveBeenCalled();
  });

  it('checks eligibility against the booking service, inside the same transaction (via the em manager)', async () => {
    await service.assignWorker('salon-1', 'booking-1', 'worker-1');

    expect(isWorkerEligibleForService).toHaveBeenCalledWith('worker-1', 'service-1', expect.anything());
  });

  // The bug this whole describe block's newest cases exist to close: assignWorker used to
  // write workerId with no availability check at all, so a provider could double-book a
  // worker across two overlapping appointments just by assigning them from the bookings list.
  it('409s with WORKER_UNAVAILABLE when the worker already has another overlapping confirmed/pending booking at that time', async () => {
    emCount.mockResolvedValueOnce(1);

    await expect(service.assignWorker('salon-1', 'booking-1', 'worker-1')).rejects.toMatchObject({
      response: { message: 'این کارمند در این زمان نوبت دیگری دارد', code: WORKER_UNAVAILABLE },
    });
    expect(emUpdate).not.toHaveBeenCalled();
  });

  it('checks the overlap using the exact same interval/status predicate as createHold, excluding the booking being assigned itself', async () => {
    await service.assignWorker('salon-1', 'booking-1', 'worker-1');

    expect(emCount).toHaveBeenCalledWith(Booking, {
      where: {
        id: Not('booking-1'),
        workerId: 'worker-1',
        status: In(['pending_payment', 'confirmed']),
        startsAt: LessThan(BOOKING.endsAt),
        endsAt: MoreThan(BOOKING.startsAt),
      },
    });
  });

  it('assigns the worker to the booking when both belong to the caller salon, the worker is active, eligible, and free', async () => {
    const result = await service.assignWorker('salon-1', 'booking-1', 'worker-1');

    expect(emUpdate).toHaveBeenCalledWith(Booking, { id: 'booking-1' }, { workerId: 'worker-1' });
    expect(redisEval).toHaveBeenCalledWith(expect.any(String), 1, 'lock:booking:salon-1', expect.any(String));
    expect(result.workerId).toBe('worker-1');
    expect(result.workerName).toBe('Sara');
  });

  describe('concurrency', () => {
    it('serializes two concurrent assignments of the same worker to overlapping bookings -- exactly one succeeds', async () => {
      // Simulates two nearly-simultaneous PATCH .../assign-worker calls for the same
      // salon by making the SECOND redis.set (i.e. the second caller to actually reach
      // Redis) fail its NX acquisition, exactly like two real concurrent requests would.
      let lockHeld = false;
      redisSet.mockImplementation(async () => {
        if (lockHeld) return null;
        lockHeld = true;
        return 'OK';
      });
      redisEval.mockImplementation(async () => {
        lockHeld = false;
        return 1;
      });

      const [first, second] = await Promise.allSettled([
        service.assignWorker('salon-1', 'booking-1', 'worker-1'),
        service.assignWorker('salon-1', 'booking-2', 'worker-1'),
      ]);

      const outcomes = [first, second];
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
      const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
    });

    // Backs the safe-Redis-lock guarantee directly: a caller whose lock expired mid-
    // critical-section (a slow DB write under load, say) and was legitimately re-acquired
    // by a second caller must NOT be able to blow away that second caller's still-live
    // lock when its own, now-stale `finally` release finally runs. redisSet/redisEval are
    // backed by a real in-memory store here (not just boolean flags) so SET's NX semantics
    // and EVAL's GET-compare-then-DEL semantics are genuinely exercised, exactly like the
    // real Lua script (RELEASE_LOCK_IF_OWNER_LUA) would behave against real Redis.
    it('never lets a stale (expired-then-lost) lock holder release a lock a second caller has since legitimately acquired', async () => {
      const store = new Map<string, string>();
      redisSet.mockImplementation(async (key: string, value: string) => {
        if (store.has(key)) return null; // NX: refuse if already held
        store.set(key, value);
        return 'OK';
      });
      redisEval.mockImplementation(async (_script: string, _numKeys: number, key: string, token: string) => {
        if (store.get(key) !== token) return 0; // not the current owner -- no-op, exactly like real Lua
        store.delete(key);
        return 1;
      });

      // First caller acquires the salon lock via a normal assignWorker call, but its own
      // critical section (the mocked DB transaction) runs long enough that the lock
      // expires and a second, independent caller acquires a NEW token for the same key
      // before the first caller's transaction returns -- simulating exactly the race the
      // production TTL leaves open.
      let firstToken: string | undefined;
      let secondToken: string | undefined;
      dataSourceTransaction.mockImplementationOnce(async (cb: (em: unknown) => unknown) => {
        firstToken = [...store.values()][0]; // the token this call's own acquireSalonLock just set
        store.delete('lock:booking:salon-1'); // simulate the PX TTL expiring mid-operation
        secondToken = 'second-caller-token';
        store.set('lock:booking:salon-1', secondToken); // a second caller races in and wins NX
        return cb({ findOneBy: emFindOneBy, count: emCount, update: emUpdate });
      });

      await service.assignWorker('salon-1', 'booking-1', 'worker-1');

      expect(firstToken).toBeDefined();
      expect(secondToken).toBe('second-caller-token');
      expect(firstToken).not.toBe(secondToken);
      // The first caller's finally-release ran (redisEval was called with its OWN stale
      // token) but must have been a no-op: the second caller's lock is still standing.
      expect(redisEval).toHaveBeenCalledWith(expect.any(String), 1, 'lock:booking:salon-1', firstToken);
      expect(store.get('lock:booking:salon-1')).toBe(secondToken);
    });

    it('a caller can always release the exact lock it itself holds', async () => {
      const store = new Map<string, string>();
      redisSet.mockImplementation(async (key: string, value: string) => {
        if (store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      });
      redisEval.mockImplementation(async (_script: string, _numKeys: number, key: string, token: string) => {
        if (store.get(key) !== token) return 0;
        store.delete(key);
        return 1;
      });

      await service.assignWorker('salon-1', 'booking-1', 'worker-1');

      // No stale-release interference in play -- the lock this call acquired is the only
      // one that ever existed for this key, and it must be gone once the call returns.
      expect(store.has('lock:booking:salon-1')).toBe(false);
    });
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
        MetricsService,
        { provide: getRepositoryToken(Booking), useValue: { find: bookingsFind, findOneBy: bookingsFindOneBy } },
        { provide: getRepositoryToken(Payment), useValue: { findOneBy: paymentsFindOneBy } },
        { provide: getRepositoryToken(Salon), useValue: { find: salonsFind } },
        { provide: getRepositoryToken(SalonService), useValue: { find: servicesFind } },
        { provide: getRepositoryToken(Worker), useValue: { find: workersFind } },
        { provide: getRepositoryToken(User), useValue: usersRepoStub() },
        { provide: UsersService, useValue: usersServiceStub() },
        { provide: AnalyticsService, useValue: { track: jest.fn().mockResolvedValue(undefined) } },
        { provide: DataSource, useValue: {} },
        { provide: PlatformConfigService, useValue: {} },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn() } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: { resolveAndValidate: jest.fn() } },
        { provide: ReferralsService, useValue: { tryGrantReward: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: WalletService,
          useValue: {
            debit: jest.fn().mockResolvedValue({ debited: 0, shortfall: 0, balanceAfter: 0, transactionId: null }),
            credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-1' }),
          },
        },
        { provide: InvoicingService, useValue: { recordCommission: jest.fn().mockResolvedValue(undefined) } },
        { provide: WorkerEligibilityService, useValue: { isWorkerEligibleForService: jest.fn().mockResolvedValue(true) } },
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

  it('listForSalon bounds the query with a defensive take cap, since no pagination UI consumes this yet', async () => {
    bookingsFind.mockResolvedValue([]);

    await service.listForSalon('salon-1');

    expect(bookingsFind).toHaveBeenCalledWith({
      where: { salonId: 'salon-1' },
      order: { startsAt: 'DESC' },
      take: 1000,
    });
  });

  it('listMine bounds the query with its own (smaller) defensive take cap', async () => {
    bookingsFind.mockResolvedValue([]);

    await service.listMine('customer-1');

    expect(bookingsFind).toHaveBeenCalledWith({
      where: { userId: 'customer-1' },
      order: { startsAt: 'DESC' },
      take: 500,
    });
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
  let emUpdate: jest.Mock;
  let tryGrantReward: jest.Mock;
  let recordCommission: jest.Mock;
  let getFeatureFlags: jest.Mock;

  const CONFIRMED_BOOKING = {
    id: 'booking-1',
    userId: 'customer-1',
    salonId: 'salon-1',
    status: 'confirmed',
    depositAmount: 40_000,
  };

  beforeEach(async () => {
    bookingsFindOneBy = jest.fn().mockResolvedValue({ ...CONFIRMED_BOOKING });
    emUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    tryGrantReward = jest.fn().mockResolvedValue(undefined);
    recordCommission = jest.fn().mockResolvedValue(undefined);
    getFeatureFlags = jest.fn().mockResolvedValue({ referralsEnabled: true });

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        MetricsService,
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(Salon), useValue: {} },
        { provide: getRepositoryToken(SalonService), useValue: {} },
        { provide: getRepositoryToken(Worker), useValue: {} },
        { provide: getRepositoryToken(User), useValue: usersRepoStub() },
        { provide: UsersService, useValue: usersServiceStub() },
        { provide: AnalyticsService, useValue: { track: jest.fn().mockResolvedValue(undefined) } },
        {
          provide: DataSource,
          useValue: { transaction: jest.fn((cb: (em: unknown) => unknown) => cb({ update: emUpdate })) },
        },
        { provide: PlatformConfigService, useValue: { getFeatureFlags } },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn() } },
        { provide: REDIS, useValue: {} },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PaymentsService, useValue: { attemptRefund: jest.fn() } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: CouponsService, useValue: { resolveAndValidate: jest.fn() } },
        { provide: ReferralsService, useValue: { tryGrantReward } },
        {
          provide: WalletService,
          useValue: {
            debit: jest.fn().mockResolvedValue({ debited: 0, shortfall: 0, balanceAfter: 0, transactionId: null }),
            credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-1' }),
          },
        },
        { provide: InvoicingService, useValue: { recordCommission } },
        { provide: WorkerEligibilityService, useValue: { isWorkerEligibleForService: jest.fn().mockResolvedValue(true) } },
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

  it('does NOT call tryGrantReward when feature_referrals_enabled is off, but still completes the booking', async () => {
    getFeatureFlags.mockResolvedValue({ referralsEnabled: false });

    const result = await service.updateStatus('salon-1', 'booking-1', 'completed');

    expect(tryGrantReward).not.toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('still returns the updated booking even when tryGrantReward throws (never fails the status update response)', async () => {
    tryGrantReward.mockRejectedValue(new Error('referral granting blew up'));

    const result = await service.updateStatus('salon-1', 'booking-1', 'completed');

    expect(result).toBeDefined();
    expect(tryGrantReward).toHaveBeenCalled();
  });

  it('records a commission ledger row for a completed booking, inside the same transaction as the status write', async () => {
    await service.updateStatus('salon-1', 'booking-1', 'completed');

    expect(recordCommission).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'booking-1', salonId: 'salon-1', depositAmount: 40_000 }));
  });

  it('records a commission ledger row for a no-show identically to a completion', async () => {
    await service.updateStatus('salon-1', 'booking-1', 'no_show');

    expect(recordCommission).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'booking-1' }));
  });

  it('rolls back the status write when recording the commission row fails', async () => {
    recordCommission.mockRejectedValue(new Error('db down'));

    await expect(service.updateStatus('salon-1', 'booking-1', 'completed')).rejects.toThrow('db down');
    // tryGrantReward runs AFTER the transaction commits -- a rolled-back transaction
    // must never reach it.
    expect(tryGrantReward).not.toHaveBeenCalled();
  });
});
