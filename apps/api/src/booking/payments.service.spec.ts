import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { PushService } from '../push/push.service';
import { ReferralsService } from '../referrals/referrals.service';
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
    expect(pushSend).toHaveBeenCalledWith('user-1', expect.objectContaining({ title: expect.any(String) }));
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

    expect(result).toEqual({ status: 'failed', bookingId: 'booking-1' });
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
      ],
    }).compile();
    const service = moduleRef.get(PaymentsService);

    await expect(service.handleCallback('AUTH123', 'OK')).rejects.toThrow('db down');

    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'verify-persist:pay-1', severity: 'warning' }),
    );
  });
});
