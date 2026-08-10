import { CronJobRunner } from './cron-job-runner.service';

describe('CronJobRunner', () => {
  let runExclusive: jest.Mock;
  let raise: jest.Mock;
  let captureException: jest.Mock;
  let runner: CronJobRunner;

  beforeEach(() => {
    jest.useFakeTimers();
    // Mirrors CronLockService.runExclusive's real contract: invoke the callback only
    // (no actual Redis involved -- CronLockService itself already has its own spec).
    runExclusive = jest.fn((_name: string, fn: () => Promise<void>, _ttl?: number) => fn());
    raise = jest.fn().mockResolvedValue(undefined);
    captureException = jest.fn();
    runner = new CronJobRunner({ runExclusive } as never, { raise } as never, { captureException } as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs fn through the distributed lock and logs start and completion on success', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    const logSpy = jest.spyOn(runner['logger'], 'log').mockImplementation();

    await runner.run('booking-expiry', fn);

    expect(runExclusive).toHaveBeenCalledWith('booking-expiry', expect.any(Function), undefined);
    expect(fn).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('Cron job "booking-expiry" started');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('completed in'));
    // Started must be logged before completed, not just both present somewhere.
    const startedCallIndex = logSpy.mock.calls.findIndex((call) => call[0] === 'Cron job "booking-expiry" started');
    const completedCallIndex = logSpy.mock.calls.findIndex((call) =>
      String(call[0]).includes('completed in'),
    );
    expect(startedCallIndex).toBeGreaterThanOrEqual(0);
    expect(startedCallIndex).toBeLessThan(completedCallIndex);
    expect(raise).not.toHaveBeenCalled();
  });

  it('logs start even when fn subsequently fails', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    const logSpy = jest.spyOn(runner['logger'], 'log').mockImplementation();
    jest.spyOn(runner['logger'], 'error').mockImplementation();

    await runner.run('refund-retry', fn);

    expect(logSpy).toHaveBeenCalledWith('Cron job "refund-retry" started');
  });

  it('forwards a custom lockTtlMs to CronLockService', async () => {
    await runner.run('storage-reconciliation', jest.fn().mockResolvedValue(undefined), { lockTtlMs: 300_000 });

    expect(runExclusive).toHaveBeenCalledWith('storage-reconciliation', expect.any(Function), 300_000);
  });

  it('raises a critical alert and logs the error when fn throws, without rethrowing', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('db connection lost'));
    const errorSpy = jest.spyOn(runner['logger'], 'error').mockImplementation();

    await expect(runner.run('payment-reconciliation', fn)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('db connection lost'), expect.any(String));
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'cron-job-failed:payment-reconciliation',
        severity: 'critical',
        dedupHours: 1,
      }),
    );
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'db connection lost' }),
      { extra: { jobName: 'payment-reconciliation', durationMs: expect.any(Number) } },
    );
  });

  it('does not capture an exception (or raise an alert) when fn succeeds', async () => {
    await runner.run('booking-expiry', jest.fn().mockResolvedValue(undefined));

    expect(captureException).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });

  it('fires a slow-job warning alert after warnAfterMs while fn is still running, without cancelling it', async () => {
    let resolveFn!: () => void;
    const fn = jest.fn(() => new Promise<void>((resolve) => { resolveFn = resolve; }));

    const runPromise = runner.run('story-cleanup', fn, { warnAfterMs: 5_000 });

    await jest.advanceTimersByTimeAsync(5_000);
    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'cron-job-slow:story-cleanup', severity: 'warning' }),
    );

    // fn is still genuinely running -- the warning did not abandon or cancel it.
    expect(fn).toHaveBeenCalledTimes(1);
    resolveFn();
    await runPromise;
  });

  it('does not fire the slow-job warning when fn completes before warnAfterMs', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);

    await runner.run('referral-grant', fn, { warnAfterMs: 60_000 });
    await jest.advanceTimersByTimeAsync(60_000);

    expect(raise).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'cron-job-slow:referral-grant' }));
  });
});
