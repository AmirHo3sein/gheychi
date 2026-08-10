import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { CouponRedemption } from '../coupons/coupon-redemption.entity';
import { PushService } from '../push/push.service';
import { ReferralsService } from '../referrals/referrals.service';
import { WalletService } from '../wallet/wallet.service';
import { SMS_PROVIDER } from '../sms/sms.provider';
import { SalonsService } from '../salons/salons.service';
import { UsersService } from '../users/users.service';
import { Booking } from './booking.entity';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Payment } from './payment.entity';
import { PaymentsService } from './payments.service';

describe('PaymentsService.attemptRefund', () => {
  let service: PaymentsService;
  let paymentsFindOneBy: jest.Mock;
  let paymentsUpdate: jest.Mock;
  let bookingsFindOneBy: jest.Mock;
  let refundPayment: jest.Mock;
  let smsSend: jest.Mock;
  let pushSend: jest.Mock;
  let raise: jest.Mock;
  let reverseIfNeeded: jest.Mock;

  const REFUND_PENDING_PAYMENT = {
    id: 'pay-1',
    bookingId: 'booking-1',
    authority: 'AUTH123',
    status: 'refund_pending',
  };

  beforeEach(async () => {
    paymentsFindOneBy = jest.fn();
    paymentsUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    bookingsFindOneBy = jest.fn().mockResolvedValue({ id: 'booking-1', userId: 'user-1', salonId: 'salon-1' });
    refundPayment = jest.fn();
    smsSend = jest.fn().mockResolvedValue(undefined);
    pushSend = jest.fn().mockResolvedValue(undefined);
    raise = jest.fn().mockResolvedValue(undefined);
    reverseIfNeeded = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: { findOneBy: paymentsFindOneBy, update: paymentsUpdate } },
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: DataSource, useValue: {} },
        { provide: SalonsService, useValue: {} },
        { provide: UsersService, useValue: { findById: jest.fn().mockResolvedValue({ id: 'user-1', phone: '09120000000' }) } },
        { provide: SMS_PROVIDER, useValue: { send: smsSend } },
        { provide: PAYMENT_GATEWAY, useValue: { refundPayment } },
        { provide: PushService, useValue: { sendToUser: pushSend } },
        { provide: AlertsService, useValue: { raise } },
        { provide: ReferralsService, useValue: { reverseIfNeeded } },
        { provide: WalletService, useValue: { debit: jest.fn(), credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-1' }) } },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
  });

  it('refunds a refund_pending payment: gateway call, race-safe update, customer notification', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT });
    refundPayment.mockResolvedValue({ success: true, refundRefId: 'RR-1' });

    const outcome = await service.attemptRefund('booking-1');

    expect(outcome).toBe('refunded');
    expect(refundPayment).toHaveBeenCalledWith('AUTH123');
    expect(paymentsUpdate).toHaveBeenCalledWith(
      { id: 'pay-1', status: 'refund_pending' },
      expect.objectContaining({ status: 'refunded', refundRefId: 'RR-1', refundedAt: expect.any(Date) }),
    );
    expect(smsSend).toHaveBeenCalledWith('09120000000', expect.any(String));
    expect(pushSend).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ title: expect.any(String), data: { type: 'booking', bookingId: 'booking-1' } }),
    );
    expect(raise).not.toHaveBeenCalled();
    expect(reverseIfNeeded).toHaveBeenCalledWith('booking-1');
  });

  it('still reports a successful refund even if the referral-reversal check throws', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT });
    refundPayment.mockResolvedValue({ success: true, refundRefId: 'RR-1' });
    reverseIfNeeded.mockRejectedValue(new Error('reversal check blew up'));

    const outcome = await service.attemptRefund('booking-1');

    expect(outcome).toBe('refunded'); // the refund itself already committed -- priority
  });

  it('skips a payment that is not refund_pending without touching the gateway', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT, status: 'paid' });
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('skipped');
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('skips a missing payment', async () => {
    paymentsFindOneBy.mockResolvedValue(null);
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('skipped');
    expect(refundPayment).not.toHaveBeenCalled();
  });

  it('leaves a payment with no authority pending and never calls the gateway', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT, authority: null });
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('pending');
    expect(refundPayment).not.toHaveBeenCalled();
    expect(paymentsUpdate).not.toHaveBeenCalled();
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'refund-no-authority:pay-1', severity: 'critical' }),
    );
  });

  it('leaves the payment pending when the gateway refuses the refund', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT });
    refundPayment.mockResolvedValue({ success: false, refundRefId: null });
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('pending');
    expect(paymentsUpdate).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'refund-refused:pay-1', severity: 'warning' }),
    );
  });

  it('catches a gateway throw and leaves the payment pending (never propagates)', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT });
    refundPayment.mockRejectedValue(new Error('Zarinpal refund failed: fetch failed'));
    const outcome = await service.attemptRefund('booking-1');
    expect(outcome).toBe('pending');
    expect(paymentsUpdate).not.toHaveBeenCalled();
  });

  it('does not notify when a concurrent attempt already won the conditional update', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...REFUND_PENDING_PAYMENT });
    refundPayment.mockResolvedValue({ success: true, refundRefId: 'RR-1' });
    paymentsUpdate.mockResolvedValue({ affected: 0 });

    const outcome = await service.attemptRefund('booking-1');

    expect(outcome).toBe('skipped');
    expect(smsSend).not.toHaveBeenCalled();
    expect(pushSend).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.notifyCancelled', () => {
  let service: PaymentsService;
  let bookingsFindOneBy: jest.Mock;
  let salonsFindById: jest.Mock;
  let usersFindById: jest.Mock;
  let smsSend: jest.Mock;
  let pushSend: jest.Mock;

  const BOOKING = { id: 'booking-1', userId: 'user-1', salonId: 'salon-1', startsAt: new Date('2026-09-01T09:00:00.000Z') };
  const SALON = { id: 'salon-1', name: 'سالن آرا', ownerId: 'owner-1' };
  const CUSTOMER = { id: 'user-1', phone: '09120000000' };
  const OWNER = { id: 'owner-1', phone: '09121111111' };

  beforeEach(async () => {
    bookingsFindOneBy = jest.fn().mockResolvedValue({ ...BOOKING });
    salonsFindById = jest.fn().mockResolvedValue({ ...SALON });
    usersFindById = jest.fn().mockImplementation((id: string) =>
      Promise.resolve(id === 'user-1' ? { ...CUSTOMER } : id === 'owner-1' ? { ...OWNER } : null),
    );
    smsSend = jest.fn().mockResolvedValue(undefined);
    pushSend = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: DataSource, useValue: {} },
        { provide: SalonsService, useValue: { findById: salonsFindById } },
        { provide: UsersService, useValue: { findById: usersFindById } },
        { provide: SMS_PROVIDER, useValue: { send: smsSend } },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PushService, useValue: { sendToUser: pushSend } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: ReferralsService, useValue: {} },
        { provide: WalletService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
  });

  it('notifies only the customer when the SALON cancelled -- the owner does not need to notify themselves', async () => {
    await service.notifyCancelled('booking-1', 'salon');

    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(smsSend).toHaveBeenCalledWith('09120000000', expect.stringContaining('لغو شد'));
    expect(pushSend).toHaveBeenCalledTimes(1);
    expect(pushSend).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ title: expect.any(String), data: { type: 'booking', bookingId: 'booking-1' } }),
    );
  });

  it('notifies BOTH the customer and the owner when the CUSTOMER cancelled -- the owner sees the slot freed up', async () => {
    await service.notifyCancelled('booking-1', 'user');

    expect(smsSend).toHaveBeenCalledTimes(2);
    expect(smsSend).toHaveBeenCalledWith('09120000000', expect.any(String));
    expect(smsSend).toHaveBeenCalledWith('09121111111', expect.any(String));
    expect(pushSend).toHaveBeenCalledTimes(2);
    expect(pushSend).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ data: { type: 'booking', bookingId: 'booking-1' } }),
    );
    expect(pushSend).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({ data: { type: 'booking', bookingId: 'booking-1' } }),
    );
  });

  it('no-ops without throwing when the booking no longer exists', async () => {
    bookingsFindOneBy.mockResolvedValue(null);

    await expect(service.notifyCancelled('booking-1', 'user')).resolves.toBeUndefined();
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('no-ops without throwing when the salon no longer exists', async () => {
    salonsFindById.mockResolvedValue(null);

    await expect(service.notifyCancelled('booking-1', 'user')).resolves.toBeUndefined();
    expect(smsSend).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.notifyConfirmed', () => {
  let service: PaymentsService;
  let bookingsFindOneBy: jest.Mock;
  let salonsFindById: jest.Mock;
  let usersFindById: jest.Mock;
  let smsSend: jest.Mock;
  let pushSend: jest.Mock;

  const BOOKING = { id: 'booking-1', userId: 'user-1', salonId: 'salon-1', startsAt: new Date('2026-09-01T09:00:00.000Z') };
  const SALON = { id: 'salon-1', name: 'سالن آرا', ownerId: 'owner-1', address: 'تهران' };
  const CUSTOMER = { id: 'user-1', phone: '09120000000' };
  const OWNER = { id: 'owner-1', phone: '09121111111' };

  beforeEach(async () => {
    bookingsFindOneBy = jest.fn().mockResolvedValue({ ...BOOKING });
    salonsFindById = jest.fn().mockResolvedValue({ ...SALON });
    usersFindById = jest.fn().mockImplementation((id: string) =>
      Promise.resolve(id === 'user-1' ? { ...CUSTOMER } : id === 'owner-1' ? { ...OWNER } : null),
    );
    smsSend = jest.fn().mockResolvedValue(undefined);
    pushSend = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: {} },
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: bookingsFindOneBy } },
        { provide: DataSource, useValue: {} },
        { provide: SalonsService, useValue: { findById: salonsFindById } },
        { provide: UsersService, useValue: { findById: usersFindById } },
        { provide: SMS_PROVIDER, useValue: { send: smsSend } },
        { provide: PAYMENT_GATEWAY, useValue: {} },
        { provide: PushService, useValue: { sendToUser: pushSend } },
        { provide: AlertsService, useValue: { raise: jest.fn() } },
        { provide: ReferralsService, useValue: {} },
        { provide: WalletService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
  });

  it('sends the customer and owner push notifications with structured deep-link data pointing at the confirmed booking', async () => {
    await service.notifyConfirmed('booking-1');

    expect(pushSend).toHaveBeenCalledTimes(2);
    expect(pushSend).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ title: 'تایید نوبت', data: { type: 'booking', bookingId: 'booking-1' } }),
    );
    expect(pushSend).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({ title: 'نوبت جدید', data: { type: 'booking', bookingId: 'booking-1' } }),
    );
  });
});

describe('PaymentsService.handleCallback lost-CAS recovery', () => {
  let service: PaymentsService;
  let paymentsFindOneBy: jest.Mock;
  let paymentsUpdate: jest.Mock;
  let verifyPayment: jest.Mock;
  let raise: jest.Mock;

  const INITIATED_PAYMENT = {
    id: 'pay-1',
    bookingId: 'booking-1',
    authority: 'AUTH123',
    amount: 200_000,
    status: 'initiated',
  };

  beforeEach(async () => {
    paymentsFindOneBy = jest.fn();
    paymentsUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    verifyPayment = jest.fn().mockResolvedValue({ success: true, refId: 'REF-1' });
    raise = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: { findOneBy: paymentsFindOneBy, update: paymentsUpdate } },
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: jest.fn() } },
        {
          provide: DataSource,
          // Every em.update returns affected=0, so the initiated->paid CAS inside
          // handleCallback's transaction is always LOST -- exactly the state after a
          // concurrent writer (duplicate callback or cancel()) beat this call.
          useValue: {
            transaction: jest.fn(async (cb: (em: unknown) => unknown) =>
              cb({ update: jest.fn().mockResolvedValue({ affected: 0 }) }),
            ),
          },
        },
        { provide: SalonsService, useValue: {} },
        { provide: UsersService, useValue: { findById: jest.fn() } },
        { provide: SMS_PROVIDER, useValue: { send: jest.fn() } },
        { provide: PAYMENT_GATEWAY, useValue: { verifyPayment } },
        { provide: PushService, useValue: { sendToUser: jest.fn() } },
        { provide: AlertsService, useValue: { raise } },
        { provide: ReferralsService, useValue: { reverseIfNeeded: jest.fn().mockResolvedValue(undefined) } },
        { provide: WalletService, useValue: { debit: jest.fn(), credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-1' }) } },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
  });

  it('queues an automatic refund when cancel() marked the payment failed mid-callback (captured money must not strand)', async () => {
    // First read (pre-verify): still initiated. Re-read after losing the CAS:
    // 'failed' -- cancel() committed while we were inside verifyPayment.
    paymentsFindOneBy
      .mockResolvedValueOnce({ ...INITIATED_PAYMENT })
      .mockResolvedValueOnce({ ...INITIATED_PAYMENT, status: 'failed' });

    const result = await service.handleCallback('AUTH123', 'OK');

    // 'refunding', never 'failed': the money WAS captured and is being sent back, so the
    // customer must not be told that no payment happened.
    expect(result).toEqual({ status: 'refunding', bookingId: 'booking-1' });
    expect(paymentsUpdate).toHaveBeenCalledWith(
      { id: 'pay-1', status: 'failed' },
      expect.objectContaining({ status: 'refund_pending', refId: 'REF-1', refundRequestedAt: expect.any(Date) }),
    );
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'late-capture:pay-1', severity: 'warning' }),
    );
  });

  it('treats a lost CAS with the payment already paid as a benign duplicate callback', async () => {
    paymentsFindOneBy
      .mockResolvedValueOnce({ ...INITIATED_PAYMENT })
      .mockResolvedValueOnce({ ...INITIATED_PAYMENT, status: 'paid' });

    const result = await service.handleCallback('AUTH123', 'OK');

    expect(result).toEqual({ status: 'success', bookingId: 'booking-1' });
    expect(paymentsUpdate).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.handleCallback — capture, dead bookings and unknown authorities', () => {
  let service: PaymentsService;
  let paymentsFindOneBy: jest.Mock;
  let paymentsUpdate: jest.Mock;
  // Raw read of the append-only payment_authorities ledger (no ORM entity by design).
  let authoritiesQuery: jest.Mock;
  let verifyPayment: jest.Mock;
  let emUpdate: jest.Mock;
  let emDelete: jest.Mock;
  let smsSend: jest.Mock;
  let raise: jest.Mock;

  const INITIATED_PAYMENT = {
    id: 'pay-1',
    bookingId: 'booking-1',
    authority: 'AUTH123',
    amount: 200_000,
    status: 'initiated',
  };

  beforeEach(async () => {
    paymentsFindOneBy = jest.fn().mockResolvedValue({ ...INITIATED_PAYMENT });
    paymentsUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    authoritiesQuery = jest.fn().mockResolvedValue([]);
    verifyPayment = jest.fn().mockResolvedValue({ success: true, refId: 'REF-1' });
    emUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    emDelete = jest.fn().mockResolvedValue({ affected: 0 });
    smsSend = jest.fn().mockResolvedValue(undefined);
    raise = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(Payment),
          useValue: {
            findOneBy: paymentsFindOneBy,
            update: paymentsUpdate,
            manager: { query: authoritiesQuery },
          },
        },
        {
          provide: getRepositoryToken(Booking),
          useValue: {
            findOneBy: jest
              .fn()
              .mockResolvedValue({ id: 'booking-1', userId: 'user-1', salonId: 'salon-1', startsAt: new Date() }),
          },
        },
        {
          provide: DataSource,
          useValue: {
            // find: [] -- releaseBookingHold's wallet-reversal lookup (inside markFailed's
            // verify-failed branch) runs unconditionally alongside the coupon-redemption
            // delete; these tests don't exercise wallet spend, so an empty result keeps
            // that half a no-op.
            transaction: jest.fn(async (cb: (em: unknown) => unknown) =>
              cb({ update: emUpdate, delete: emDelete, find: jest.fn().mockResolvedValue([]) }),
            ),
          },
        },
        {
          provide: SalonsService,
          useValue: { findById: jest.fn().mockResolvedValue({ id: 'salon-1', ownerId: 'owner-1', name: 'S', address: 'A' }) },
        },
        { provide: UsersService, useValue: { findById: jest.fn().mockResolvedValue({ id: 'user-1', phone: '09120000000' }) } },
        { provide: SMS_PROVIDER, useValue: { send: smsSend } },
        { provide: PAYMENT_GATEWAY, useValue: { verifyPayment } },
        { provide: PushService, useValue: { sendToUser: jest.fn().mockResolvedValue(undefined) } },
        { provide: AlertsService, useValue: { raise } },
        { provide: ReferralsService, useValue: { reverseIfNeeded: jest.fn().mockResolvedValue(undefined) } },
        { provide: WalletService, useValue: { debit: jest.fn(), credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-1' }) } },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
  });

  it('confirms only a booking still in pending_payment, and records the session that paid', async () => {
    const result = await service.handleCallback('AUTH123', 'OK');

    expect(result).toEqual({ status: 'success', bookingId: 'booking-1' });
    expect(emUpdate).toHaveBeenCalledWith(
      Booking,
      { id: 'booking-1', status: 'pending_payment' },
      { status: 'confirmed' },
    );
    expect(emUpdate).toHaveBeenCalledWith(
      Payment,
      { id: 'pay-1', status: 'initiated' },
      expect.objectContaining({ status: 'paid', refId: 'REF-1', paidAt: expect.any(Date), authority: 'AUTH123' }),
    );
  });

  it('never resurrects a booking that already left pending_payment -- refunds the late capture instead', async () => {
    // BookingExpiryJob flipped the booking to 'expired' but left the payment
    // 'initiated', so the payment CAS alone would still have succeeded and
    // re-confirmed a slot that was released and may already be rebooked.
    emUpdate.mockImplementation(async (entity: unknown) => (entity === Booking ? { affected: 0 } : { affected: 1 }));

    const result = await service.handleCallback('AUTH123', 'OK');

    // The booking is gone but the deposit was captured and is being refunded -- reported as
    // 'refunding' so the callback page can say so instead of "payment failed".
    expect(result).toEqual({ status: 'refunding', bookingId: 'booking-1' });
    expect(emUpdate).not.toHaveBeenCalledWith(Payment, expect.anything(), expect.objectContaining({ status: 'paid' }));
    expect(paymentsUpdate).toHaveBeenCalledWith(
      { id: 'pay-1', status: 'initiated' },
      expect.objectContaining({ status: 'refund_pending', refId: 'REF-1', refundRequestedAt: expect.any(Date) }),
    );
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ key: 'late-capture:pay-1', severity: 'warning' }));
    expect(smsSend).not.toHaveBeenCalled(); // never a "booking confirmed" SMS for a dead booking
  });

  it('verifies a success callback even when the payment was already marked failed, and queues the refund', async () => {
    // cancel() / reconciliation mark a payment 'failed' without asking Zarinpal, so a
    // payment completed afterwards is real money -- and no job ever revisits 'failed'.
    paymentsFindOneBy.mockResolvedValue({ ...INITIATED_PAYMENT, status: 'failed' });

    const result = await service.handleCallback('AUTH123', 'OK');

    expect(verifyPayment).toHaveBeenCalledWith('AUTH123', 200_000);
    expect(result).toEqual({ status: 'refunding', bookingId: 'booking-1' });
    expect(paymentsUpdate).toHaveBeenCalledWith(
      { id: 'pay-1', status: 'failed' },
      expect.objectContaining({ status: 'refund_pending', refId: 'REF-1', refundRequestedAt: expect.any(Date) }),
    );
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ key: 'late-capture:pay-1', severity: 'warning' }));
  });

  it('leaves an already-failed payment alone when the gateway reports failure too', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...INITIATED_PAYMENT, status: 'failed' });

    const result = await service.handleCallback('AUTH123', 'NOK');

    expect(result).toEqual({ status: 'failed', bookingId: 'booking-1' });
    expect(verifyPayment).not.toHaveBeenCalled();
    expect(emUpdate).not.toHaveBeenCalled(); // no second cancellation write
    expect(paymentsUpdate).not.toHaveBeenCalled();
  });

  it('leaves an already-failed payment alone when the verify declines it', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...INITIATED_PAYMENT, status: 'failed' });
    verifyPayment.mockResolvedValue({ success: false, refId: null });

    const result = await service.handleCallback('AUTH123', 'OK');

    expect(result).toEqual({ status: 'failed', bookingId: 'booking-1' });
    expect(emUpdate).not.toHaveBeenCalled();
    expect(paymentsUpdate).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });

  it('does not re-verify a payment already queued for refund, and reports it as refunding', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...INITIATED_PAYMENT, status: 'refund_pending' });

    const result = await service.handleCallback('AUTH123', 'OK');

    // A refresh of the callback URL after the refund was queued: money was captured, so
    // 'failed' would again tell the customer the opposite of the truth.
    expect(result).toEqual({ status: 'refunding', bookingId: 'booking-1' });
    expect(verifyPayment).not.toHaveBeenCalled();
  });

  it('reports an already-refunded payment as refunding rather than failed', async () => {
    paymentsFindOneBy.mockResolvedValue({ ...INITIATED_PAYMENT, status: 'refunded' });

    const result = await service.handleCallback('AUTH123', 'OK');

    expect(result).toEqual({ status: 'refunding', bookingId: 'booking-1' });
    expect(verifyPayment).not.toHaveBeenCalled();
  });

  it('still reports a genuine decline as failed (nothing captured)', async () => {
    verifyPayment.mockResolvedValue({ success: false, refId: null });

    const result = await service.handleCallback('AUTH123', 'OK');

    // The whole point of the third state: 'failed' stays reserved for "no money moved".
    expect(result).toEqual({ status: 'failed', bookingId: 'booking-1' });
    expect(paymentsUpdate).not.toHaveBeenCalled();
  });

  it('cancels a status-guarded booking and releases its coupon when the gateway reports NOK', async () => {
    const result = await service.handleCallback('AUTH123', 'NOK');

    expect(result).toEqual({ status: 'failed', bookingId: 'booking-1' });
    expect(emUpdate).toHaveBeenCalledWith(Payment, { id: 'pay-1', status: 'initiated' }, { status: 'failed' });
    // Status-guarded: an already-expired booking must not be rewritten as cancelled_by_user.
    expect(emUpdate).toHaveBeenCalledWith(
      Booking,
      { id: 'booking-1', status: 'pending_payment' },
      { status: 'cancelled_by_user' },
    );
    // Nothing was captured, so the coupon code the hold consumed goes back.
    expect(emDelete).toHaveBeenCalledWith(CouponRedemption, expect.objectContaining({ bookingId: expect.anything() }));
  });

  it('resolves a SUPERSEDED authority through the ledger instead of 404ing on it', async () => {
    // retryPayment overwrote payments.authority with a newer session; the customer paid
    // through their still-open older tab.
    paymentsFindOneBy.mockResolvedValueOnce(null).mockResolvedValue({ ...INITIATED_PAYMENT, authority: 'AUTH-NEW' });
    authoritiesQuery.mockResolvedValue([{ payment_id: 'pay-1' }]);

    const result = await service.handleCallback('AUTH-OLD', 'OK');

    expect(result).toEqual({ status: 'success', bookingId: 'booking-1' });
    expect(authoritiesQuery).toHaveBeenCalledWith(expect.stringContaining('payment_authorities'), ['AUTH-OLD']);
    // The paying session replaces the superseded one, so a refund targets the real transaction.
    expect(emUpdate).toHaveBeenCalledWith(
      Payment,
      { id: 'pay-1', status: 'initiated' },
      expect.objectContaining({ status: 'paid', authority: 'AUTH-OLD' }),
    );
  });

  it('treats a genuinely unknown authority as money-critical instead of throwing a 404 at the customer', async () => {
    paymentsFindOneBy.mockResolvedValue(null);

    const result = await service.handleCallback('GARBAGE', 'OK');

    expect(result).toEqual({ status: 'unknown-authority', bookingId: null });
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'unknown-authority', severity: 'critical' }),
    );
  });

  it('does not alert for an unknown authority on a failed callback (public endpoint, no money involved)', async () => {
    paymentsFindOneBy.mockResolvedValue(null);

    const result = await service.handleCallback('GARBAGE', 'NOK');

    expect(result).toEqual({ status: 'unknown-authority', bookingId: null });
    expect(raise).not.toHaveBeenCalled();
  });

  it('handles a callback with no Authority at all without querying on an undefined value', async () => {
    const result = await service.handleCallback('', 'OK');

    expect(result).toEqual({ status: 'unknown-authority', bookingId: null });
    expect(paymentsFindOneBy).not.toHaveBeenCalled();
    expect(authoritiesQuery).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.handleCallback verify-persist failure', () => {
  it('raises a warning alert when persisting the verified payment fails, and still rethrows', async () => {
    const raise = jest.fn().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(Payment),
          useValue: {
            findOneBy: jest.fn().mockResolvedValue({
              id: 'pay-1',
              bookingId: 'booking-1',
              authority: 'AUTH123',
              amount: 200_000,
              status: 'initiated',
            }),
            update: jest.fn(),
          },
        },
        { provide: getRepositoryToken(Booking), useValue: { findOneBy: jest.fn() } },
        // Zarinpal has already confirmed the charge (verify succeeds below); the
        // transaction persisting paid/confirmed then fails -- the .catch must fire
        // the verify-persist alert and still rethrow for the caller.
        { provide: DataSource, useValue: { transaction: jest.fn().mockRejectedValue(new Error('db down')) } },
        { provide: SalonsService, useValue: {} },
        { provide: UsersService, useValue: { findById: jest.fn() } },
        { provide: SMS_PROVIDER, useValue: { send: jest.fn() } },
        {
          provide: PAYMENT_GATEWAY,
          useValue: { verifyPayment: jest.fn().mockResolvedValue({ success: true, refId: 'REF-1' }) },
        },
        { provide: PushService, useValue: { sendToUser: jest.fn() } },
        { provide: AlertsService, useValue: { raise } },
        { provide: ReferralsService, useValue: { reverseIfNeeded: jest.fn().mockResolvedValue(undefined) } },
        { provide: WalletService, useValue: { debit: jest.fn(), credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-1' }) } },
      ],
    }).compile();
    const service = moduleRef.get(PaymentsService);

    await expect(service.handleCallback('AUTH123', 'OK')).rejects.toThrow('db down');

    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'verify-persist:pay-1', severity: 'warning' }),
    );
  });
});
