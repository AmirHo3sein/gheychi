import { CronLockService } from './cron-lock.service';
import { RELEASE_LOCK_IF_OWNER_LUA } from './redis-lock.util';

describe('CronLockService', () => {
  let set: jest.Mock;
  let evalScript: jest.Mock;
  let service: CronLockService;

  // The token acquireLock generated for the run under test -- read back off the SET call
  // rather than stubbed, since it is a fresh random UUID per acquisition by design.
  const acquiredToken = () => set.mock.calls[0][1] as string;

  beforeEach(() => {
    set = jest.fn().mockResolvedValue('OK');
    evalScript = jest.fn().mockResolvedValue(1);
    service = new CronLockService({ set, eval: evalScript } as never);
  });

  it('acquires the lock with the cron-lock: prefix and a per-run random token, then runs fn', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);

    await service.runExclusive('booking-expiry', fn);

    expect(set).toHaveBeenCalledWith('cron-lock:booking-expiry', expect.any(String), 'PX', 60_000, 'NX');
    expect(acquiredToken()).not.toBe('1'); // never a shared constant -- that defeats the ownership check
    expect(fn).toHaveBeenCalled();
  });

  it('gives two runs of the same job distinct tokens', async () => {
    await service.runExclusive('refund-retry', jest.fn().mockResolvedValue(undefined));
    await service.runExclusive('refund-retry', jest.fn().mockResolvedValue(undefined));

    expect(set.mock.calls[0][1]).not.toBe(set.mock.calls[1][1]);
  });

  it('skips fn entirely when another instance already holds the lock', async () => {
    set.mockResolvedValue(null);
    const fn = jest.fn();

    await service.runExclusive('booking-expiry', fn);

    expect(fn).not.toHaveBeenCalled();
    expect(evalScript).not.toHaveBeenCalled();
  });

  it('releases the lock after fn resolves, via the owner-checked compare-and-delete', async () => {
    await service.runExclusive('story-cleanup', jest.fn().mockResolvedValue(undefined));

    expect(evalScript).toHaveBeenCalledWith(RELEASE_LOCK_IF_OWNER_LUA, 1, 'cron-lock:story-cleanup', acquiredToken());
  });

  it('releases the lock even when fn throws', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(service.runExclusive('refund-retry', fn)).rejects.toThrow('boom');
    expect(evalScript).toHaveBeenCalledWith(RELEASE_LOCK_IF_OWNER_LUA, 1, 'cron-lock:refund-retry', acquiredToken());
  });

  it('never issues an unconditional DEL, so an overrunning run cannot free a successor lock', async () => {
    // The regression this guards: a run that outlives its TTL has already lost the lock to
    // expiry and a second replica may hold it. A blind `del` in the `finally` would delete
    // THAT replica's live lock and admit a third concurrent run of a financial job.
    const del = jest.fn();
    service = new CronLockService({ set, eval: evalScript, del } as never);

    await service.runExclusive('refund-retry', jest.fn().mockResolvedValue(undefined));

    expect(del).not.toHaveBeenCalled();
  });

  it('accepts a custom TTL override', async () => {
    await service.runExclusive('storage-reconciliation', jest.fn().mockResolvedValue(undefined), 300_000);

    expect(set).toHaveBeenCalledWith('cron-lock:storage-reconciliation', expect.any(String), 'PX', 300_000, 'NX');
  });
});
