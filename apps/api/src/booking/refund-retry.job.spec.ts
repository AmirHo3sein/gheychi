import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LessThan } from 'typeorm';
import { Payment } from './payment.entity';
import { PaymentsService } from './payments.service';
import { RefundRetryJob } from './refund-retry.job';

describe('RefundRetryJob', () => {
  let job: RefundRetryJob;
  let paymentsFind: jest.Mock;
  let attemptRefund: jest.Mock;

  beforeEach(async () => {
    paymentsFind = jest.fn().mockResolvedValue([]);
    attemptRefund = jest.fn().mockResolvedValue('refunded');

    const moduleRef = await Test.createTestingModule({
      providers: [
        RefundRetryJob,
        { provide: getRepositoryToken(Payment), useValue: { find: paymentsFind } },
        { provide: PaymentsService, useValue: { attemptRefund } },
      ],
    }).compile();

    job = moduleRef.get(RefundRetryJob);
  });

  it('only selects refund_pending payments past the grace period', async () => {
    await job.run();

    const where = paymentsFind.mock.calls[0][0].where;
    expect(where.status).toBe('refund_pending');
    // grace period: refund_requested_at must be at least ~2 minutes old
    expect(where.refundRequestedAt).toEqual(LessThan(expect.any(Date)));
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
  });
});
