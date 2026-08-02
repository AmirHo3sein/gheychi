import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { Booking } from './booking.entity';
import { CouponRedemption } from '../coupons/coupon-redemption.entity';
import { WalletService } from '../wallet/wallet.service';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Payment } from './payment.entity';
import { PaymentReconciliationJob } from './payment-reconciliation.job';

describe('PaymentReconciliationJob', () => {
  let job: PaymentReconciliationJob;
  let paymentsFind: jest.Mock;
  // Raw read of the append-only payment_authorities ledger (no ORM entity by design).
  let authoritiesQuery: jest.Mock;
  let verifyPayment: jest.Mock;
  let emUpdate: jest.Mock;
  let emDelete: jest.Mock;
  let raise: jest.Mock;

  const STALE_PAYMENT = {
    id: 'pay-1',
    bookingId: 'booking-1',
    authority: 'AUTH123',
    amount: 200_000,
    status: 'initiated',
  };

  beforeEach(async () => {
    paymentsFind = jest.fn().mockResolvedValue([]);
    authoritiesQuery = jest.fn().mockResolvedValue([]);
    verifyPayment = jest.fn();
    emUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    emDelete = jest.fn().mockResolvedValue({ affected: 0 });
    raise = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentReconciliationJob,
        {
          provide: getRepositoryToken(Payment),
          useValue: { find: paymentsFind, manager: { query: authoritiesQuery } },
        },
        {
          provide: DataSource,
          useValue: {
            // find: [] -- releaseBookingHold's wallet-reversal lookup runs unconditionally
            // alongside the coupon-redemption delete on the verify-failed branch; these
            // tests don't exercise wallet spend, so an empty result keeps that half a no-op.
            transaction: jest.fn(async (cb: (em: unknown) => unknown) =>
              cb({ update: emUpdate, delete: emDelete, find: jest.fn().mockResolvedValue([]) }),
            ),
          },
        },
        { provide: PAYMENT_GATEWAY, useValue: { verifyPayment } },
        { provide: AlertsService, useValue: { raise } },
        { provide: WalletService, useValue: { debit: jest.fn(), credit: jest.fn().mockResolvedValue({ balanceAfter: 0, transactionId: 'wt-1' }) } },
      ],
    }).compile();

    job = moduleRef.get(PaymentReconciliationJob);
  });

  it('confirms the booking and marks the payment paid when verify succeeds in time', async () => {
    paymentsFind.mockResolvedValue([{ ...STALE_PAYMENT }]);
    verifyPayment.mockResolvedValue({ success: true, refId: 'REF-1' });

    const reconciled = await job.run();

    expect(reconciled).toBe(1);
    expect(emUpdate).toHaveBeenCalledWith(Booking, { id: 'booking-1', status: 'pending_payment' }, { status: 'confirmed' });
    expect(emUpdate).toHaveBeenCalledWith(
      Payment,
      { id: 'pay-1', status: 'initiated' },
      expect.objectContaining({ status: 'paid', refId: 'REF-1', paidAt: expect.any(Date), authority: 'AUTH123' }),
    );
    expect(raise).not.toHaveBeenCalled();
    // Money moved: the coupon this booking consumed stays spent.
    expect(emDelete).not.toHaveBeenCalled();
  });

  it('queues an automatic refund when the money was captured but the booking already moved on', async () => {
    paymentsFind.mockResolvedValue([{ ...STALE_PAYMENT }]);
    verifyPayment.mockResolvedValue({ success: true, refId: 'REF-1' });
    // Booking left pending_payment (expired/cancelled): the booking CAS loses...
    emUpdate.mockImplementation(async (entity: unknown) =>
      entity === Booking ? { affected: 0 } : { affected: 1 },
    );

    await job.run();

    // ...and the captured payment is queued for a real refund, not stranded.
    expect(emUpdate).toHaveBeenCalledWith(
      Payment,
      { id: 'pay-1', status: 'initiated' },
      expect.objectContaining({ status: 'refund_pending', refId: 'REF-1', refundRequestedAt: expect.any(Date) }),
    );
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'late-capture:pay-1', severity: 'warning' }),
    );
  });

  it('cancels the booking and fails the payment (guarded on initiated) when verify reports no capture', async () => {
    paymentsFind.mockResolvedValue([{ ...STALE_PAYMENT }]);
    verifyPayment.mockResolvedValue({ success: false, refId: null });

    await job.run();

    expect(emUpdate).toHaveBeenCalledWith(
      Booking,
      { id: 'booking-1', status: 'pending_payment' },
      { status: 'cancelled_by_user' },
    );
    // The 'initiated' guard: a late OK callback marking the payment paid between
    // verify and this transaction must not be clobbered to 'failed'.
    expect(emUpdate).toHaveBeenCalledWith(Payment, { id: 'pay-1', status: 'initiated' }, { status: 'failed' });
    // Nothing was ever captured, so the coupon code the dead hold consumed is released
    // -- otherwise an abandoned payment burns the customer's code for life.
    expect(emDelete).toHaveBeenCalledWith(CouponRedemption, expect.objectContaining({ bookingId: expect.anything() }));
  });

  it('skips payments with no authority at all (none current, none in the ledger)', async () => {
    paymentsFind.mockResolvedValue([{ ...STALE_PAYMENT, authority: null }]);

    const reconciled = await job.run();

    expect(reconciled).toBe(0);
    expect(verifyPayment).not.toHaveBeenCalled();
  });

  it('verifies a SUPERSEDED authority too, and records the session that actually captured', async () => {
    // retryPayment minted AUTH-NEW over AUTH-OLD; the customer paid through the older,
    // still-open Zarinpal tab. Reconciling only payments.authority would declare this a
    // failure with the money captured.
    paymentsFind.mockResolvedValue([{ ...STALE_PAYMENT, authority: 'AUTH-NEW' }]);
    authoritiesQuery.mockResolvedValue([{ authority: 'AUTH-NEW' }, { authority: 'AUTH-OLD' }]);
    verifyPayment
      .mockResolvedValueOnce({ success: false, refId: null })
      .mockResolvedValueOnce({ success: true, refId: 'REF-OLD' });

    const reconciled = await job.run();

    expect(reconciled).toBe(1);
    expect(verifyPayment).toHaveBeenNthCalledWith(1, 'AUTH-NEW', 200_000);
    expect(verifyPayment).toHaveBeenNthCalledWith(2, 'AUTH-OLD', 200_000);
    // authority is re-pointed at the paying session -- refunds are issued against it.
    expect(emUpdate).toHaveBeenCalledWith(
      Payment,
      { id: 'pay-1', status: 'initiated' },
      expect.objectContaining({ status: 'paid', refId: 'REF-OLD', authority: 'AUTH-OLD' }),
    );
  });

  it('only declares a failure once every known authority declines', async () => {
    paymentsFind.mockResolvedValue([{ ...STALE_PAYMENT, authority: 'AUTH-NEW' }]);
    authoritiesQuery.mockResolvedValue([{ authority: 'AUTH-NEW' }, { authority: 'AUTH-OLD' }]);
    verifyPayment.mockResolvedValue({ success: false, refId: null });

    await job.run();

    expect(verifyPayment).toHaveBeenCalledTimes(2);
    expect(emUpdate).toHaveBeenCalledWith(Payment, { id: 'pay-1', status: 'initiated' }, { status: 'failed' });
  });

  it('continues the batch when one payment errors (per-payment isolation)', async () => {
    const errorSpy = jest.spyOn(job['logger'], 'error').mockImplementation();
    paymentsFind.mockResolvedValue([
      { ...STALE_PAYMENT },
      { ...STALE_PAYMENT, id: 'pay-2', bookingId: 'booking-2', authority: 'AUTH456' },
    ]);
    verifyPayment.mockRejectedValueOnce(new Error('gateway down')).mockResolvedValueOnce({ success: true, refId: 'REF-2' });

    const reconciled = await job.run();

    expect(reconciled).toBe(1);
    expect(verifyPayment).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('pay-1'));
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'reconcile-failed:pay-1', severity: 'warning' }),
    );
  });
});
