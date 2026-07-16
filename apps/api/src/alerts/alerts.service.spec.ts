import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import RedisMock from 'ioredis-mock';
import Redis from 'ioredis';
import { SmsProvider } from '../sms/sms.provider';
import { AlertsService } from './alerts.service';

const PHONE_1 = '09121111111';
const PHONE_2 = '09122222222';

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  return {
    get: jest.fn((key: string, def?: unknown) => (key in overrides ? overrides[key] : def)),
  } as unknown as ConfigService;
}

function makeSms(): { provider: SmsProvider; send: jest.Mock } {
  const send = jest.fn().mockResolvedValue(undefined);
  return { provider: { send, sendOtp: jest.fn() } as unknown as SmsProvider, send };
}

function makeBrokenRedis(): Redis {
  const pipeline = { exec: jest.fn().mockRejectedValue(new Error('redis down')) } as Record<string, jest.Mock>;
  pipeline.incr = jest.fn().mockReturnValue(pipeline);
  pipeline.expire = jest.fn().mockReturnValue(pipeline);
  return {
    set: jest.fn().mockRejectedValue(new Error('redis down')),
    del: jest.fn().mockRejectedValue(new Error('redis down')),
    multi: jest.fn().mockReturnValue(pipeline),
  } as unknown as Redis;
}

describe('AlertsService', () => {
  let redis: InstanceType<typeof RedisMock>;

  beforeEach(() => {
    redis = new RedisMock();
  });

  afterEach(async () => {
    await redis.flushall();
  });

  function makeService(configOverrides: Record<string, unknown> = {}, redisClient: Redis = redis as never) {
    const { provider, send } = makeSms();
    const service = new AlertsService(
      provider,
      redisClient,
      makeConfig({ OPS_ALERT_PHONES: `${PHONE_1},${PHONE_2}`, SMS_PROVIDER: 'kavenegar', ...configOverrides }),
    );
    return { service, send };
  }

  it('fans out to every configured phone with the [Arayeshgah] prefix', async () => {
    const { service, send } = makeService();

    await service.notifyOps('refund-stuck:pay-1', 'refund-stuck: payment pay-1');

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(PHONE_1, '[Arayeshgah] refund-stuck: payment pay-1');
    expect(send).toHaveBeenCalledWith(PHONE_2, '[Arayeshgah] refund-stuck: payment pay-1');
  });

  it('suppresses a repeat alert for the same dedupe key inside the TTL window', async () => {
    const { service, send } = makeService();

    await service.notifyOps('refund-stuck:pay-1', 'first');
    await service.notifyOps('refund-stuck:pay-1', 'second');

    expect(send).toHaveBeenCalledTimes(2); // one fan-out to two phones, no second alert
  });

  it('sends for a different dedupe key even while another key is throttled', async () => {
    const { service, send } = makeService();

    await service.notifyOps('refund-stuck:pay-1', 'first');
    await service.notifyOps('refund-stuck:pay-2', 'second');

    expect(send).toHaveBeenCalledTimes(4);
  });

  it('uses the default TTL from OPS_ALERT_THROTTLE_HOURS and honors a per-call ttlSeconds override', async () => {
    // Deliberately NOT the built-in default (6): proves the env var is
    // actually read, not that the hardcoded fallback happens to match.
    const { service } = makeService({ OPS_ALERT_THROTTLE_HOURS: 2 });

    await service.notifyOps('key-default', 'msg');
    await service.notifyOps('key-override', 'msg', { ttlSeconds: 86_400 });

    expect(await redis.ttl('ops-alert:key-default')).toBe(2 * 3600);
    expect(await redis.ttl('ops-alert:key-override')).toBe(86_400);
  });

  it('logs an unrouted warn and sends nothing when OPS_ALERT_PHONES is empty', async () => {
    const { provider, send } = makeSms();
    const service = new AlertsService(provider, redis as never, makeConfig({ OPS_ALERT_PHONES: '' }));
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();

    await service.notifyOps('refund-stuck:pay-1', 'payment pay-1 stuck');

    expect(send).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[unrouted ops alert] payment pay-1 stuck');
    expect(await redis.exists('ops-alert:refund-stuck:pay-1')).toBe(0);
  });

  it('releases the throttle key when every send fails, so the next tick retries delivery', async () => {
    const { service, send } = makeService();
    send.mockRejectedValue(new Error('kavenegar down'));
    jest.spyOn(service['logger'], 'error').mockImplementation();

    await service.notifyOps('refund-stuck:pay-1', 'msg');

    expect(await redis.exists('ops-alert:refund-stuck:pay-1')).toBe(0);

    // …and a retry on the next tick goes through.
    send.mockResolvedValue(undefined);
    await service.notifyOps('refund-stuck:pay-1', 'msg');
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('keeps the throttle key on a partial failure (at least one operator was paged)', async () => {
    const { service, send } = makeService();
    send.mockRejectedValueOnce(new Error('one recipient failed')).mockResolvedValueOnce(undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation();

    await service.notifyOps('refund-stuck:pay-1', 'msg');

    expect(await redis.exists('ops-alert:refund-stuck:pay-1')).toBe(1);
  });

  it('falls back to in-process dedupe when the Redis SET throws: still sends once per TTL', async () => {
    const brokenRedis = makeBrokenRedis();
    const { service, send } = makeService({}, brokenRedis);
    jest.spyOn(service['logger'], 'warn').mockImplementation();

    await service.notifyOps('refund-stuck:pay-1', 'first');
    await service.notifyOps('refund-stuck:pay-1', 'second');

    expect(send).toHaveBeenCalledTimes(2); // one fan-out, second call deduped in-process
  });

  it('suppresses sends above the hourly cap and log-warns', async () => {
    const { service, send } = makeService({ OPS_ALERT_HOURLY_CAP: 2 });
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();

    await service.notifyOps('k1', 'msg');
    await service.notifyOps('k2', 'msg');
    await service.notifyOps('k3', 'msg');

    expect(send).toHaveBeenCalledTimes(4); // k1 + k2 fanned out, k3 suppressed
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('hourly cap'));
  });

  it('releases the throttle key on cap suppression, so the alert retries once the capped hour rolls over', async () => {
    const { service, send } = makeService({ OPS_ALERT_HOURLY_CAP: 1 });
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();

    await service.notifyOps('k1', 'msg');
    await service.notifyOps('k2', 'msg'); // over the cap: suppressed, nothing delivered

    expect(send).toHaveBeenCalledTimes(2); // k1 only
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('hourly cap'));
    // The suppressed alert's throttle key was released, not left claiming its full TTL.
    expect(await redis.exists('ops-alert:k2')).toBe(0);

    // Simulate the capped hour rolling over: the counter bucket disappears.
    await redis.del(`ops-alert:count:${Math.floor(Date.now() / 3_600_000)}`);
    await service.notifyOps('k2', 'msg');
    expect(send).toHaveBeenCalledTimes(4); // k2 delivered on the retry tick
  });

  it.each(['6h', '', 0, -1])(
    'falls back to the built-in defaults and warns at boot when OPS_ALERT_THROTTLE_HOURS / OPS_ALERT_HOURLY_CAP is %p',
    (bad) => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { provider } = makeSms();
      const service = new AlertsService(
        provider,
        redis as never,
        makeConfig({
          OPS_ALERT_PHONES: PHONE_1,
          SMS_PROVIDER: 'kavenegar',
          OPS_ALERT_THROTTLE_HOURS: bad,
          OPS_ALERT_HOURLY_CAP: bad,
        }),
      );

      expect(service['defaultTtlSeconds']).toBe(6 * 3600);
      expect(service['hourlyCap']).toBe(30);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`OPS_ALERT_THROTTLE_HOURS is set but is not a positive number ('${bad}')`));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`OPS_ALERT_HOURLY_CAP is set but is not a positive number ('${bad}')`));
      warnSpy.mockRestore();
    },
  );

  it('torture: Redis throws AND sms rejects simultaneously -- notifyOps still resolves', async () => {
    const brokenRedis = makeBrokenRedis();
    const { provider, send } = makeSms();
    send.mockRejectedValue(new Error('kavenegar down'));
    const service = new AlertsService(
      provider,
      brokenRedis,
      makeConfig({ OPS_ALERT_PHONES: `${PHONE_1},${PHONE_2}`, SMS_PROVIDER: 'kavenegar' }),
    );
    jest.spyOn(service['logger'], 'warn').mockImplementation();
    jest.spyOn(service['logger'], 'error').mockImplementation();

    await expect(service.notifyOps('refund-stuck:pay-1', 'msg')).resolves.toBeUndefined();
    // All sends failed, so the in-process throttle entry was released too --
    // the next tick retries instead of being muted for the full TTL.
    await expect(service.notifyOps('refund-stuck:pay-1', 'msg')).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('warns at boot when OPS_ALERT_PHONES is set but SMS_PROVIDER is not kavenegar', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { provider } = makeSms();
    new AlertsService(
      provider,
      redis as never,
      makeConfig({ OPS_ALERT_PHONES: PHONE_1, SMS_PROVIDER: 'console' }),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('only print to logs'));
    warnSpy.mockRestore();
  });

  it('warns at boot when OPS_ALERT_PHONES is non-empty but contains no parseable numbers, then routes alerts to the unrouted log path', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { provider, send } = makeSms();
    const service = new AlertsService(
      provider,
      redis as never,
      makeConfig({ OPS_ALERT_PHONES: 'not-a-phone, 123', SMS_PROVIDER: 'kavenegar' }),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no parseable'));

    await service.notifyOps('k', 'msg');
    expect(send).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[unrouted ops alert] msg');
    warnSpy.mockRestore();
  });
});
