import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Booking } from './booking.entity';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Payment } from './payment.entity';
import { PaymentReconciliationJob } from './payment-reconciliation.job';

describe('PaymentReconciliationJob', () => {
  let job: PaymentReconciliationJob;
  let paymentsFind: jest.Mock;
  let verifyPayment: jest.Mock;
  let emUpdate: jest.Mock;

  const STALE_PAYMENT = {
    id: 'pay-1',
    bookingId: 'booking-1',
    authority: 'AUTH123',
    amount: 200_000,
    status: 'initiated',
  };

  beforeEach(async () => {
    paymentsFind = jest.fn().mockResolvedValue([]);
    verifyPayment = jest.fn();
    emUpdate = jest.fn().mockResolvedValue({ affected: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentReconciliationJob,
        { provide: getRepositoryToken(Payment), useValue: { find: paymentsFind } },
        {
          provide: DataSource,
          useValue: { transaction: jest.fn(async (cb: (em: unknown) => unknown) => cb({ update: emUpdate })) },
        },
        { provide: PAYMENT_GATEWAY, useValue: { verifyPayment } },
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
    expect(emUpdate).toHaveBeenCalledWith(Payment, { id: 'pay-1', status: 'initiated' }, { status: 'paid', refId: 'REF-1' });
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
  });

  it('skips payments with no authority', async () => {
    paymentsFind.mockResolvedValue([{ ...STALE_PAYMENT, authority: null }]);

    const reconciled = await job.run();

    expect(reconciled).toBe(0);
    expect(verifyPayment).not.toHaveBeenCalled();
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
  });
});
