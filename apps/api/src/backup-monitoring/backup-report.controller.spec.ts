import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AlertsService } from '../alerts/alerts.service';
import { MetricsService } from '../metrics/metrics.service';
import { REDIS } from '../redis/redis.module';
import { BACKUP_LAST_SUCCESS_KEY, BackupReportController } from './backup-report.controller';

// The guard (shared-secret validation) is unit-tested independently in
// backup-report-secret.guard.spec.ts -- this spec instantiates the controller directly
// (via Test.createTestingModule with only the controller's own deps mocked, same
// pattern as payments.controller.spec.ts) and calls `report()` straight through, so it
// exercises the handler's own logic without going through the HTTP/guard pipeline at
// all. ConfigService is still provided below (unused by any assertion here) purely
// because the controller carries @UseGuards(BackupReportSecretGuard) at the class level
// -- Nest's testing module resolves that guard's own dependencies while wiring the
// controller, even though no request ever reaches canActivate() in this spec.
describe('BackupReportController', () => {
  let controller: BackupReportController;
  let redisSet: jest.Mock;
  let observeBackupReport: jest.Mock;
  let raise: jest.Mock;

  beforeEach(async () => {
    redisSet = jest.fn().mockResolvedValue('OK');
    observeBackupReport = jest.fn();
    raise = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [BackupReportController],
      providers: [
        { provide: REDIS, useValue: { set: redisSet } },
        { provide: MetricsService, useValue: { observeBackupReport } },
        { provide: AlertsService, useValue: { raise } },
        { provide: ConfigService, useValue: { getOrThrow: jest.fn().mockReturnValue('test-secret') } },
      ],
    }).compile();

    controller = moduleRef.get(BackupReportController);
  });

  describe('status: success', () => {
    it('writes an ISO timestamp to backup:last-success in Redis', async () => {
      const before = Date.now();
      await controller.report({ status: 'success', sizeBytes: 12_345_678, durationMs: 4200 });

      expect(redisSet).toHaveBeenCalledTimes(1);
      const [key, value] = redisSet.mock.calls[0];
      expect(key).toBe(BACKUP_LAST_SUCCESS_KEY);
      expect(typeof value).toBe('string');
      const writtenAt = new Date(value as string).getTime();
      expect(writtenAt).toBeGreaterThanOrEqual(before);
      expect(writtenAt).toBeLessThanOrEqual(Date.now());
    });

    it('records a success metric and never calls AlertsService', async () => {
      await controller.report({ status: 'success' });

      expect(observeBackupReport).toHaveBeenCalledWith('success');
      expect(raise).not.toHaveBeenCalled();
    });

    it('works with only the required field set (sizeBytes/durationMs omitted)', async () => {
      await expect(controller.report({ status: 'success' })).resolves.toBeUndefined();
      expect(redisSet).toHaveBeenCalledTimes(1);
    });
  });

  describe('status: failure', () => {
    it('never writes to Redis and records a failure metric', async () => {
      await controller.report({ status: 'failure', error: 'mc cp exited with code 1' });

      expect(redisSet).not.toHaveBeenCalled();
      expect(observeBackupReport).toHaveBeenCalledWith('failure');
    });

    it('calls AlertsService.raise with severity critical, key backup-failed, dedupHours 1', async () => {
      await controller.report({ status: 'failure', error: 'dump file too small: 412 bytes' });

      expect(raise).toHaveBeenCalledTimes(1);
      expect(raise).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'backup-failed',
          severity: 'critical',
          dedupHours: 1,
        }),
      );
    });

    it('includes the reported error string in the alert body when present', async () => {
      await controller.report({ status: 'failure', error: 'dump file too small: 412 bytes' });

      const input = raise.mock.calls[0][0];
      expect(input.body).toContain('dump file too small: 412 bytes');
    });

    it('still raises a well-formed alert when no error string was reported', async () => {
      await controller.report({ status: 'failure' });

      expect(raise).toHaveBeenCalledTimes(1);
      const input = raise.mock.calls[0][0];
      expect(typeof input.title).toBe('string');
      expect(input.title.length).toBeGreaterThan(0);
      expect(typeof input.body).toBe('string');
      expect(input.body.length).toBeGreaterThan(0);
    });
  });
});
