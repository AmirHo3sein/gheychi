import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { WalletService } from '../wallet/wallet.service';
import { Booking } from './booking.entity';
import { BookingApprovalExpiryJob } from './booking-approval-expiry.job';
import { BookingEventsService } from './booking-events.service';
import { PaymentsService } from './payments.service';

// The fluent UPDATE chain the job builds. Every method returns the builder so the call
// order under test is exactly the production one; only execute() resolves.
function makeQueryBuilder(returnedIds: string[]) {
  const builder: Record<string, jest.Mock> = {};
  for (const method of ['update', 'set', 'where', 'andWhere', 'setParameters', 'returning']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.execute = jest.fn().mockResolvedValue({ raw: returnedIds.map((id) => ({ id })) });
  return builder;
}

describe('BookingApprovalExpiryJob', () => {
  let job: BookingApprovalExpiryJob;
  let builder: Record<string, jest.Mock>;
  let em: { createQueryBuilder: jest.Mock; delete: jest.Mock; find: jest.Mock; query: jest.Mock };
  let bookingEvents: { record: jest.Mock; recordMany: jest.Mock };
  let paymentsService: { notifyApprovalExpired: jest.Mock };
  let jobRunner: { run: jest.Mock };

  async function build(expiredIds: string[]) {
    builder = makeQueryBuilder(expiredIds);
    em = {
      createQueryBuilder: jest.fn(() => builder),
      // releaseBookingHold's own two statements: it deletes coupon redemptions, then
      // looks up each booking's wallet spend. No wallet rows here by default.
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      find: jest.fn().mockResolvedValue([]),
      query: jest.fn().mockResolvedValue([]),
    };
    bookingEvents = { record: jest.fn().mockResolvedValue(undefined), recordMany: jest.fn().mockResolvedValue(undefined) };
    paymentsService = { notifyApprovalExpired: jest.fn().mockResolvedValue(undefined) };
    jobRunner = { run: jest.fn(async (_name: string, fn: () => Promise<void>) => fn()) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingApprovalExpiryJob,
        {
          provide: getRepositoryToken(Booking),
          useValue: { manager: { transaction: jest.fn((cb: (m: unknown) => unknown) => cb(em)) } },
        },
        { provide: WalletService, useValue: { credit: jest.fn(), debit: jest.fn() } },
        { provide: CronJobRunner, useValue: jobRunner },
        { provide: BookingEventsService, useValue: bookingEvents },
        { provide: PaymentsService, useValue: paymentsService },
      ],
    }).compile();
    job = moduleRef.get(BookingApprovalExpiryJob);
  }

  it('expires only pending_approval rows whose own snapshotted deadline has passed', async () => {
    await build(['b1', 'b2']);

    const count = await job.run();

    expect(count).toBe(2);
    expect(builder.set).toHaveBeenCalledWith({ status: 'expired' });
    expect(builder.where).toHaveBeenCalledWith('status = :status', { status: 'pending_approval' });
    // The deadline predicate is the snapshotted column, never a live-config recomputation
    // -- that is what stops an admin's timeout edit from moving an in-flight request.
    expect(builder.andWhere).toHaveBeenCalledWith(
      'approval_expires_at IS NOT NULL AND approval_expires_at <= :now',
    );
    const params = builder.setParameters.mock.calls[0]![0] as { status: string; now: Date };
    expect(params.status).toBe('pending_approval');
    expect(params.now).toBeInstanceOf(Date);
  });

  it('returns 0 and notifies nobody when nothing is due', async () => {
    await build([]);

    expect(await job.run()).toBe(0);
    expect(paymentsService.notifyApprovalExpired).not.toHaveBeenCalled();
    expect(bookingEvents.recordMany).toHaveBeenCalledWith([], em);
  });

  it('gives back the coupon code every expired request was holding', async () => {
    await build(['b1', 'b2']);

    await job.run();

    // releaseBookingHold's coupon-redemption delete, scoped to exactly the set this run won.
    expect(em.delete).toHaveBeenCalled();
    const [, criteria] = em.delete.mock.calls[0]!;
    expect(JSON.stringify(criteria)).toContain('b1');
    expect(JSON.stringify(criteria)).toContain('b2');
  });

  it('records an APPROVAL_EXPIRED and a SLOT_RELEASED event per expired request, attributed to the system', async () => {
    await build(['b1']);

    await job.run();

    // One batched write, not 2 round-trips per booking -- at the 1000-row batch cap that
    // is what keeps the transaction (and so the cron lock) short.
    const [rows, passedEm] = bookingEvents.recordMany.mock.calls[0]!;
    expect(passedEm).toBe(em);
    expect(rows).toEqual([
      expect.objectContaining({ bookingId: 'b1', eventType: 'APPROVAL_EXPIRED', actorType: 'system' }),
      expect.objectContaining({ bookingId: 'b1', eventType: 'SLOT_RELEASED', actorType: 'system' }),
    ]);
  });

  it('notifies each customer that their request expired and that nothing was charged', async () => {
    await build(['b1', 'b2']);

    await job.run();

    expect(paymentsService.notifyApprovalExpired).toHaveBeenCalledTimes(2);
    expect(paymentsService.notifyApprovalExpired).toHaveBeenCalledWith('b1');
    expect(paymentsService.notifyApprovalExpired).toHaveBeenCalledWith('b2');
  });

  // The expiry is already committed by the time notifications run, so a failing SMS must
  // never roll it back or abort the rest of the batch -- otherwise one unreachable phone
  // number would stall every other expiry behind it, forever.
  it('keeps expiring the rest of the batch when one notification throws', async () => {
    await build(['b1', 'b2']);
    paymentsService.notifyApprovalExpired.mockRejectedValueOnce(new Error('sms down'));

    await expect(job.run()).resolves.toBe(2);
    expect(paymentsService.notifyApprovalExpired).toHaveBeenCalledTimes(2);
  });

  it('handleCron delegates to run() through the shared CronJobRunner lock', async () => {
    await build([]);

    await job.handleCron();

    // The 5-minute lock override matters: the default 60s equals this job's own tick
    // period, so a run that outlives it would let the next tick double-notify.
    expect(jobRunner.run).toHaveBeenCalledWith(
      'booking-approval-expiry',
      expect.any(Function),
      { lockTtlMs: 5 * 60_000 },
    );
  });
});
