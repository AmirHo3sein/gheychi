import { Test } from '@nestjs/testing';
import { AlertsService } from '../alerts/alerts.service';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { REDIS } from '../redis/redis.module';
import { BACKUP_LAST_SUCCESS_KEY } from './backup-report.controller';
import { BackupStalenessCheckJob } from './backup-staleness-check.job';

describe('BackupStalenessCheckJob', () => {
  let job: BackupStalenessCheckJob;
  let redisGet: jest.Mock;
  let raise: jest.Mock;

  beforeEach(async () => {
    redisGet = jest.fn().mockResolvedValue(null);
    raise = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        BackupStalenessCheckJob,
        { provide: REDIS, useValue: { get: redisGet } },
        { provide: AlertsService, useValue: { raise } },
        { provide: CronJobRunner, useValue: { run: jest.fn((_name: string, fn: () => Promise<void>) => fn()) } },
      ],
    }).compile();

    job = moduleRef.get(BackupStalenessCheckJob);
  });

  it('alerts backup-stale (critical) when backup:last-success is entirely missing', async () => {
    redisGet.mockResolvedValue(null);

    const result = await job.run();

    expect(result).toBe('missing');
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ key: 'backup-stale', severity: 'critical' }));
  });

  it('alerts backup-stale when the stored value is unparseable as a date', async () => {
    redisGet.mockResolvedValue('not-a-real-timestamp');

    const result = await job.run();

    expect(result).toBe('missing');
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ key: 'backup-stale', severity: 'critical' }));
  });

  it('does not alert when the last success is well within the staleness threshold', async () => {
    redisGet.mockResolvedValue(new Date(Date.now() - 2 * 3_600_000).toISOString()); // 2h ago

    const result = await job.run();

    expect(result).toBe('ok');
    expect(raise).not.toHaveBeenCalled();
  });

  it('does not alert right at a fresh boundary (23h ago, under the 27h threshold)', async () => {
    redisGet.mockResolvedValue(new Date(Date.now() - 23 * 3_600_000).toISOString());

    const result = await job.run();

    expect(result).toBe('ok');
    expect(raise).not.toHaveBeenCalled();
  });

  it('alerts backup-stale when the last success is past the staleness threshold', async () => {
    redisGet.mockResolvedValue(new Date(Date.now() - 30 * 3_600_000).toISOString()); // 30h ago

    const result = await job.run();

    expect(result).toBe('stale');
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ key: 'backup-stale', severity: 'critical' }));
    const input = raise.mock.calls[0][0];
    expect(input.body).toContain('30');
  });

  it('reads exactly the same Redis key the report controller writes', async () => {
    await job.run();
    expect(redisGet).toHaveBeenCalledWith(BACKUP_LAST_SUCCESS_KEY);
  });
});
