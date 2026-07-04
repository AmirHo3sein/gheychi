import { HttpException, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

const OTP_TTL_SEC = 120;
const RATE_LIMIT_MAX = 3;
const RATE_WINDOW_SEC = 3600;
const MAX_VERIFY_ATTEMPTS = 5;

@Injectable()
export class OtpService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async issue(phone: string): Promise<string> {
    const rlKey = `rl:otp:${phone}`;
    const count = await this.redis.incr(rlKey);
    if (count === 1) await this.redis.expire(rlKey, RATE_WINDOW_SEC);
    if (count > RATE_LIMIT_MAX) {
      throw new HttpException('Too many OTP requests', 429);
    }
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(`otp:${phone}`, code, 'EX', OTP_TTL_SEC);
    await this.redis.del(`otp:att:${phone}`);
    return code;
  }

  async verify(phone: string, code: string): Promise<boolean> {
    const key = `otp:${phone}`;
    const attemptsKey = `otp:att:${phone}`;
    const stored = await this.redis.get(key);
    if (!stored) return false;

    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) await this.redis.expire(attemptsKey, OTP_TTL_SEC);
    if (attempts > MAX_VERIFY_ATTEMPTS) {
      await this.redis.del(key, attemptsKey);
      return false;
    }
    if (stored !== code) return false;

    await this.redis.del(key, attemptsKey);
    return true;
  }
}
