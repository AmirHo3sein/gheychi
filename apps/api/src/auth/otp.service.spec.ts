import { HttpException } from '@nestjs/common';
import RedisMock from 'ioredis-mock';
import { OtpService, OTP_TTL_SEC, RATE_LIMIT_MAX } from './otp.service';

describe('OtpService', () => {
  let redis: InstanceType<typeof RedisMock>;
  let service: OtpService;
  const phone = '09121234567';

  beforeEach(() => {
    redis = new RedisMock();
    service = new OtpService(redis as never);
  });

  afterEach(async () => {
    await redis.flushall();
  });

  it('issues a 6-digit code stored under otp:{phone}', async () => {
    const { code } = await service.issue(phone);
    expect(code).toMatch(/^\d{6}$/);
    expect(await redis.get(`otp:${phone}`)).toBe(code);
  });

  it('rejects the 4th request within the rate window', async () => {
    await service.issue(phone);
    await service.issue(phone);
    await service.issue(phone);
    await expect(service.issue(phone)).rejects.toThrow(HttpException);
  });

  it('reports the real TTL and counts resends down to zero', async () => {
    // The login screens render an expiry countdown and a "last resend" warning from these
    // two fields, so they have to track the limiter for real rather than being decorative.
    const first = await service.issue(phone);
    expect(first.expiresInSec).toBe(OTP_TTL_SEC);
    expect(first.resendsRemaining).toBe(RATE_LIMIT_MAX - 1);

    expect((await service.issue(phone)).resendsRemaining).toBe(RATE_LIMIT_MAX - 2);
    // Third (final) allowed request: nothing left, and the next call throws 429.
    expect((await service.issue(phone)).resendsRemaining).toBe(0);
    await expect(service.issue(phone)).rejects.toThrow(HttpException);
  });

  it('verifies a correct code and consumes it', async () => {
    const { code } = await service.issue(phone);
    expect(await service.verify(phone, code)).toBe(true);
    expect(await service.verify(phone, code)).toBe(false); // consumed
  });

  it('rejects a wrong code but allows a later correct attempt', async () => {
    const { code } = await service.issue(phone);
    expect(await service.verify(phone, '000000')).toBe(false);
    expect(await service.verify(phone, code)).toBe(true);
  });

  it('kills the code after 5 failed attempts', async () => {
    const { code } = await service.issue(phone);
    for (let i = 0; i < 5; i++) await service.verify(phone, '000000');
    expect(await service.verify(phone, code)).toBe(false);
  });
});
