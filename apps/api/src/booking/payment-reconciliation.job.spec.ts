import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { BookingEventsService } from './booking-events.service';
import { PaymentsService } from './payments.service';
import { Booking } from './booking.entity';
import { CouponRedemption } from '../coupons/coupon-redemption.entity';
import { WalletService } from '../wallet/wallet.service';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Payment } from './payment.entity';
import { PaymentReconciliationJob } from './payment-reconciliation.job';

const notifyConfirmed = jest.fn().mockResolvedValue(undefined);

describe('PaymentReconciliationJob', () => {
  let job: PaymentReconciliationJob;
  let paymentsFind: jest.Mock;
  // Raw read of the append-only payment_authorities ledger (no ORM entity by design).
  let authoritiesQuery: jest.Mock;
  let verifyPayment: jest.Mock;
  let emUpdate: jest.Mock;
  let emDelete: jest.Mock;
  let raise: jest.Mock;
  // Used only by the new "retire an authority-less payment" branch.
  let paymentsUpdate: jest.Mock;

  const STALE_PAYMENT = {
    id: 'pay-1',
    bookingId: 'booking-1',
    authority: 'AUTH123',
    amount: 200_000,
    status: 'initiated',
  };

  beforeEach(async () => {
    paymentsFind = jest.fn().mockResolvedValue([]);
    paymentsUpdate = jest.fn().mockResolvedValue({ affected: 1 });
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
          // run() selects via a QueryBuilder now (it joins bookings so a payment counts as
          // stale only once its booking's own payment window has genuinely closed -- see
          // the job's own comment). The builder is faked as a chainable no-op whose
          // getMany() yields whatever paymentsFind was primed with, so every existing test
          // keeps expressing "here is the batch" exactly as it always did.
          useValue: {
            createQueryBuilder: jest.fn(() => {
              const qb: Record<string, unknown> = {};
              for (const method of ['innerJoin', 'where', 'andWhere', 'orderBy', 'take']) {
                qb[method] = jest.fn(() => qb);
              }
              qb.getMany = jest.fn(() => paymentsFind());
              return qb;
            }),
            update: paymentsUpdate,
            manager: { query: authoritiesQuery },
          },
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
        { provide: CronJobRunner, useValue: { run: jest.fn((_name: string, fn: () => Promise<void>) => fn()) } },
        { provide: BookingEventsService, useValue: { record: jest.fn().mockResolvedValue(undefined) } },
        // A booking this job confirms (the callback never arrived) must be notified like
        // any other confirmation -- it used to tell nobody at all.
        { provide: PaymentsService, useValue: { notifyConfirmed: notifyConfirmed } },
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

  it('notifies the customer when IT is the one that confirms the booking -- the callback never arrived, so nothing else will', async () => {
    notifyConfirmed.mockClear();
    paymentsFind.mockResolvedValue([{ ...STALE_PAYMENT }]);
    verifyPayment.mockResolvedValue({ success: true, refId: 'REF-1' });

    await job.run();

    expect(notifyConfirmed).toHaveBeenCalledWith('booking-1');
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

  // Was: "skips payments with no authority at all". Skipping is what made these rows
  // immortal -- nothing else in the system ever revisits an `initiated` payment, so one
  // that never got a gateway session was re-selected on every tick forever, permanently
  // occupying a slot in a 200-row batch. Manual approval made that reachable in normal
  // operation (approve() opens the payment window and inserts the Payment row; a customer
  // who never clicks "pay" leaves it authority-less), so they are now retired instead.
  it('retires a payment that never had an authority -- nothing could have been captured through it', async () => {
    paymentsFind.mockResolvedValue([{ ...STALE_PAYMENT, authority: null }]);

    const reconciled = await job.run();

    expect(verifyPayment).not.toHaveBeenCalled();
    // Guarded on `authority IS NULL` as well as the status, so a customer minting a
    // session in the same instant wins the race and keeps their live payment.
    expect(paymentsUpdate).toHaveBeenCalledWith(
      { id: 'pay-1', status: 'initiated', authority: IsNull() },
      { status: 'failed' },
    );
    expect(reconciled).toBe(1);
  });

  it('leaves the payment alone when the retire-CAS loses to a concurrently-minted session', async () => {
    paymentsFind.mockResolvedValue([{ ...STALE_PAYMENT, authority: null }]);
    paymentsUpdate.mockResolvedValue({ affected: 0 });

    expect(await job.run()).toBe(0);
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
