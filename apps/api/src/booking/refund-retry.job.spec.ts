import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThan } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { Payment } from './payment.entity';
import { PaymentsService } from './payments.service';
import { RefundRetryJob } from './refund-retry.job';

describe('RefundRetryJob', () => {
  let job: RefundRetryJob;
  let paymentsFind: jest.Mock;
  let attemptRefund: jest.Mock;
  let notifyOps: jest.Mock;

  beforeEach(async () => {
    paymentsFind = jest.fn().mockResolvedValue([]);
    attemptRefund = jest.fn().mockResolvedValue('refunded');
    notifyOps = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RefundRetryJob,
        { provide: getRepositoryToken(Payment), useValue: { find: paymentsFind } },
        { provide: PaymentsService, useValue: { attemptRefund } },
        { provide: AlertsService, useValue: { notifyOps } },
      ],
    }).compile();

    job = moduleRef.get(RefundRetryJob);
  });

  it('only selects refund_pending payments past the grace period', async () => {
    const before = Date.now();
    await job.run();

    const where = paymentsFind.mock.calls[0][0].where;
    expect(where.status).toBe('refund_pending');
    expect(where.refundRequestedAt).toEqual(LessThan(expect.any(Date)));
    // The cutoff must be in the PAST -- a sign-flipped grace period (now + 2min)
    // would select brand-new rows and race every inline cancel attempt. Bounded
    // below too, so an absurdly large grace period can't silently disable retries.
    const cutoff: Date = (where.refundRequestedAt as { value: Date }).value;
    expect(cutoff.getTime()).toBeLessThan(before);
    expect(cutoff.getTime()).toBeGreaterThan(before - 10 * 60_000);
  });

  it('attempts a refund for each eligible payment and counts successes', async () => {
    paymentsFind.mockResolvedValue([
      { id: 'pay-1', bookingId: 'b1', refundRequestedAt: new Date(Date.now() - 10 * 60_000) },
      { id: 'pay-2', bookingId: 'b2', refundRequestedAt: new Date(Date.now() - 10 * 60_000) },
    ]);
    attemptRefund.mockResolvedValueOnce('refunded').mockResolvedValueOnce('pending');

    const refunded = await job.run();

    expect(attemptRefund).toHaveBeenCalledWith('b1');
    expect(attemptRefund).toHaveBeenCalledWith('b2');
    expect(refunded).toBe(1);
  });

  it('logs an escalation for a payment stuck refund_pending for over 24 hours', async () => {
    const errorSpy = jest.spyOn(job['logger'], 'error').mockImplementation();
    paymentsFind.mockResolvedValue([
      { id: 'pay-old', bookingId: 'b1', refundRequestedAt: new Date(Date.now() - 25 * 60 * 60_000) },
    ]);
    attemptRefund.mockResolvedValue('pending');

    await job.run();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('pay-old'));
    // The escalation also pages an operator, re-paging daily via the 24h TTL.
    expect(notifyOps).toHaveBeenCalledWith(
      'refund-stuck:pay-old',
      expect.stringContaining('pay-old'),
      { ttlSeconds: 86_400 },
    );
  });

  it('does not escalate a payment still under the 24h threshold', async () => {
    const errorSpy = jest.spyOn(job['logger'], 'error').mockImplementation();
    paymentsFind.mockResolvedValue([
      { id: 'pay-recent', bookingId: 'b1', refundRequestedAt: new Date(Date.now() - 10 * 60 * 60_000) },
    ]);
    attemptRefund.mockResolvedValue('pending');

    await job.run();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(notifyOps).not.toHaveBeenCalled();
  });

  it('continues the batch when one attemptRefund throws (per-payment isolation)', async () => {
    const errorSpy = jest.spyOn(job['logger'], 'error').mockImplementation();
    paymentsFind.mockResolvedValue([
      { id: 'pay-1', bookingId: 'b1', refundRequestedAt: new Date(Date.now() - 10 * 60_000) },
      { id: 'pay-2', bookingId: 'b2', refundRequestedAt: new Date(Date.now() - 10 * 60_000) },
    ]);
    attemptRefund.mockRejectedValueOnce(new Error('transient DB failure')).mockResolvedValueOnce('refunded');

    const refunded = await job.run();

    expect(attemptRefund).toHaveBeenCalledTimes(2);
    expect(refunded).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('pay-1'));
  });
});
