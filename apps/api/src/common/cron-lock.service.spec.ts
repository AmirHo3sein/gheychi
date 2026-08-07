import { CronLockService } from './cron-lock.service';

describe('CronLockService', () => {
  let set: jest.Mock;
  let del: jest.Mock;
  let service: CronLockService;

  beforeEach(() => {
    set = jest.fn().mockResolvedValue('OK');
    del = jest.fn().mockResolvedValue(1);
    service = new CronLockService({ set, del } as never);
  });

  it('acquires the lock with the cron-lock: prefix and runs fn when it wins', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);

    await service.runExclusive('booking-expiry', fn);

    expect(set).toHaveBeenCalledWith('cron-lock:booking-expiry', '1', 'PX', 60_000, 'NX');
    expect(fn).toHaveBeenCalled();
  });

  it('skips fn entirely when another instance already holds the lock', async () => {
    set.mockResolvedValue(null);
    const fn = jest.fn();

    await service.runExclusive('booking-expiry', fn);

    expect(fn).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('releases the lock after fn resolves', async () => {
    await service.runExclusive('story-cleanup', jest.fn().mockResolvedValue(undefined));

    expect(del).toHaveBeenCalledWith('cron-lock:story-cleanup');
  });

  it('releases the lock even when fn throws', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(service.runExclusive('refund-retry', fn)).rejects.toThrow('boom');
    expect(del).toHaveBeenCalledWith('cron-lock:refund-retry');
  });

  it('accepts a custom TTL override', async () => {
    await service.runExclusive('storage-reconciliation', jest.fn().mockResolvedValue(undefined), 300_000);

    expect(set).toHaveBeenCalledWith('cron-lock:storage-reconciliation', '1', 'PX', 300_000, 'NX');
  });
});
