import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { ReferralExpiryJob } from './referral-expiry.job';

describe('ReferralExpiryJob', () => {
  let job: ReferralExpiryJob;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn().mockResolvedValue([[], 0]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReferralExpiryJob,
        { provide: DataSource, useValue: { query } },
        { provide: CronJobRunner, useValue: { run: jest.fn((_name: string, fn: () => Promise<void>) => fn()) } },
      ],
    }).compile();

    job = moduleRef.get(ReferralExpiryJob);
  });

  it('expires referrals whose expires_at has passed while still awaiting the qualifying event', async () => {
    query.mockResolvedValue([[{ id: 'ref-1' }, { id: 'ref-2' }], 2]);

    const expired = await job.run();

    expect(expired).toBe(2);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'awaiting_qualifying_event'"), [500]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'expired'"), [500]);
  });

  it('passes the batch size as a query parameter so a single run cannot run unbounded', async () => {
    await job.run();

    expect(query).toHaveBeenCalledWith(expect.any(String), [500]);
  });

  it('returns 0 and does not log when nothing is past its expiry window', async () => {
    query.mockResolvedValue([[], 0]);
    const logSpy = jest.spyOn(job['logger'], 'log');

    const expired = await job.run();

    expect(expired).toBe(0);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs the count when referrals are expired', async () => {
    query.mockResolvedValue([[{ id: 'ref-1' }], 1]);
    const logSpy = jest.spyOn(job['logger'], 'log');

    await job.run();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1'));
  });

  it('delegates the actual filtering (expires_at, status, batch cap) entirely to the SQL statement', async () => {
    await job.run();

    const [sql] = query.mock.calls[0];
    expect(sql).toContain('expires_at IS NOT NULL');
    expect(sql).toContain('expires_at < now()');
    expect(sql).toContain('LIMIT $1');
    expect(sql).toContain('RETURNING id');
  });

  it('handleCron delegates to run()', async () => {
    const runSpy = jest.spyOn(job, 'run').mockResolvedValue(3);

    await job.handleCron();

    expect(runSpy).toHaveBeenCalled();
  });
});
