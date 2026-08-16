import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { ReferralsService } from '../referrals/referrals.service';
import { ReferralGrantJob } from './referral-grant.job';

describe('ReferralGrantJob', () => {
  let job: ReferralGrantJob;
  let query: jest.Mock;
  let tryGrantReward: jest.Mock;

  const AWAITING_CANDIDATE = { referred_user_id: 'user-1', salon_id: null };
  const TRIGGERING_BOOKING = { id: 'booking-1' };
  const PARTIAL_CANDIDATE = {
    referred_user_id: 'user-2',
    qualifying_booking_id: 'booking-2',
    qualifying_event: 'first_completed_booking',
  };

  beforeEach(async () => {
    query = jest.fn(async (sql: string) => {
      if (sql.includes("status = 'partially_granted'")) return [];
      if (sql.includes("status = 'awaiting_qualifying_event'")) return [];
      // resolveTriggeringBookingId's own SELECT
      return [TRIGGERING_BOOKING];
    });
    tryGrantReward = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReferralGrantJob,
        { provide: DataSource, useValue: { query } },
        { provide: ReferralsService, useValue: { tryGrantReward } },
        { provide: CronJobRunner, useValue: { run: jest.fn((_name: string, fn: () => Promise<void>) => fn()) } },
      ],
    }).compile();

    job = moduleRef.get(ReferralGrantJob);
  });

  it('grants a first-paid-booking reward for a referral whose holdback window has passed', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'partially_granted'")) return [];
      if (sql.includes("status = 'awaiting_qualifying_event'")) return [AWAITING_CANDIDATE];
      return [TRIGGERING_BOOKING];
    });

    const attempted = await job.run();

    expect(attempted).toBe(1);
    expect(tryGrantReward).toHaveBeenCalledWith('user-1', 'booking-1', 'paid');
  });

  it('skips a candidate when its triggering booking cannot be resolved', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'partially_granted'")) return [];
      if (sql.includes("status = 'awaiting_qualifying_event'")) return [AWAITING_CANDIDATE];
      return [];
    });

    const attempted = await job.run();

    expect(attempted).toBe(0);
    expect(tryGrantReward).not.toHaveBeenCalled();
  });

  it('retries a partially_granted referral, resolving the event type from its stored qualifying_event', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'partially_granted'")) return [PARTIAL_CANDIDATE];
      if (sql.includes("status = 'awaiting_qualifying_event'")) return [];
      return [];
    });

    const attempted = await job.run();

    expect(attempted).toBe(1);
    expect(tryGrantReward).toHaveBeenCalledWith('user-2', 'booking-2', 'completed');
  });

  it('sums attempts across both the awaiting and partially-granted sweeps', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'partially_granted'")) return [PARTIAL_CANDIDATE];
      if (sql.includes("status = 'awaiting_qualifying_event'")) return [AWAITING_CANDIDATE];
      return [TRIGGERING_BOOKING];
    });

    const attempted = await job.run();

    expect(attempted).toBe(2);
  });

  it('isolates a per-candidate failure so the rest of the batch still runs (matches every other job in this codebase)', async () => {
    const secondCandidate = { referred_user_id: 'user-3', salon_id: null };
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'partially_granted'")) return [];
      if (sql.includes("status = 'awaiting_qualifying_event'")) return [AWAITING_CANDIDATE, secondCandidate];
      return [TRIGGERING_BOOKING];
    });
    tryGrantReward.mockRejectedValueOnce(new Error('db hiccup')).mockResolvedValueOnce(undefined);
    const errorSpy = jest.spyOn(job['logger'], 'error').mockImplementation();

    const attempted = await job.run();

    expect(attempted).toBe(1);
    expect(tryGrantReward).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('user-1'));
  });

  it('handleCron delegates to run() through the shared CronJobRunner', async () => {
    const runSpy = jest.spyOn(job, 'run').mockResolvedValue(5);

    await job.handleCron();

    expect(runSpy).toHaveBeenCalled();
  });
});
