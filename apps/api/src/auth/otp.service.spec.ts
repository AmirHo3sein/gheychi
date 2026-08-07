import { HttpException } from '@nestjs/common';
import RedisMock from 'ioredis-mock';
import { IP_RATE_LIMIT_MAX, OtpService, OTP_TTL_SEC, RATE_LIMIT_MAX } from './otp.service';

describe('OtpService', () => {
  let redis: InstanceType<typeof RedisMock>;
  let service: OtpService;
  const phone = '09121234567';
  const ip = '203.0.113.1';

  beforeEach(() => {
    redis = new RedisMock();
    service = new OtpService(redis as never);
  });

  afterEach(async () => {
    await redis.flushall();
  });

  it('issues a 6-digit code stored under otp:{phone}', async () => {
    const { code } = await service.issue(phone, ip);
    expect(code).toMatch(/^\d{6}$/);
    expect(await redis.get(`otp:${phone}`)).toBe(code);
  });

  it('rejects the 4th request within the rate window', async () => {
    await service.issue(phone, ip);
    await service.issue(phone, ip);
    await service.issue(phone, ip);
    await expect(service.issue(phone, ip)).rejects.toThrow(HttpException);
  });

  it('reports the real TTL and counts resends down to zero', async () => {
    // The login screens render an expiry countdown and a "last resend" warning from these
    // two fields, so they have to track the limiter for real rather than being decorative.
    const first = await service.issue(phone, ip);
    expect(first.expiresInSec).toBe(OTP_TTL_SEC);
    expect(first.resendsRemaining).toBe(RATE_LIMIT_MAX - 1);

    expect((await service.issue(phone, ip)).resendsRemaining).toBe(RATE_LIMIT_MAX - 2);
    // Third (final) allowed request: nothing left, and the next call throws 429.
    expect((await service.issue(phone, ip)).resendsRemaining).toBe(0);
    await expect(service.issue(phone, ip)).rejects.toThrow(HttpException);
  });

  it('verifies a correct code and consumes it', async () => {
    const { code } = await service.issue(phone, ip);
    expect(await service.verify(phone, code)).toBe(true);
    expect(await service.verify(phone, code)).toBe(false); // consumed
  });

  it('rejects a wrong code but allows a later correct attempt', async () => {
    const { code } = await service.issue(phone, ip);
    expect(await service.verify(phone, '000000')).toBe(false);
    expect(await service.verify(phone, code)).toBe(true);
  });

  it('kills the code after 5 failed attempts', async () => {
    const { code } = await service.issue(phone, ip);
    for (let i = 0; i < 5; i++) await service.verify(phone, '000000');
    expect(await service.verify(phone, code)).toBe(false);
  });

  describe('per-IP limit (independent of the per-phone limit)', () => {
    it('rejects once one IP has requested codes for more than IP_RATE_LIMIT_MAX distinct phones', async () => {
      for (let i = 0; i < IP_RATE_LIMIT_MAX; i++) {
        await service.issue(`0912000000${i}`, ip);
      }
      await expect(service.issue('09129999999', ip)).rejects.toThrow(HttpException);
    });

    it('is independent per IP -- a different IP is not affected by another IP exhausting its limit', async () => {
      for (let i = 0; i < IP_RATE_LIMIT_MAX; i++) {
        await service.issue(`0912000000${i}`, ip);
      }
      await expect(service.issue('09129999999', '198.51.100.7')).resolves.toBeDefined();
    });

    it('does not burn the phone-specific quota when the request is rejected for the IP limit', async () => {
      for (let i = 0; i < IP_RATE_LIMIT_MAX; i++) {
        await service.issue(`0912000000${i}`, ip);
      }
      const blockedPhone = '09129999999';
      await expect(service.issue(blockedPhone, ip)).rejects.toThrow(HttpException); // blocked by the IP limit

      // Retrying the SAME phone from a fresh IP shows a full, untouched quota -- proving
      // the blocked attempt above never incremented this phone's own counter.
      const result = await service.issue(blockedPhone, '198.51.100.7');
      expect(result.resendsRemaining).toBe(RATE_LIMIT_MAX - 1);
    });
  });
});
