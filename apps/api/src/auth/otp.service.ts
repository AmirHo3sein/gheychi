import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

export const OTP_TTL_SEC = 120;
export const RATE_LIMIT_MAX = 3;
export const RATE_WINDOW_SEC = 3600;
// The phone-keyed limit above only bounds how many codes ONE phone number can receive --
// it does nothing to stop a single caller from cycling through many DIFFERENT phone
// numbers, each getting up to RATE_LIMIT_MAX real SMS sends at the business's expense
// (SMS-bombing arbitrary third parties, or just running up the provider bill). Higher than
// the per-phone limit so ordinary shared-IP cases (a household on one wifi, each member
// requesting a code for their own phone) aren't penalized -- it targets one attacker
// working through many numbers, not a few genuine users behind one NAT.
export const IP_RATE_LIMIT_MAX = 10;
// Wrong-guess budget per (phone, IP). Keyed per IP, not per phone alone, so a stranger who
// knows a victim's number can't burn the victim's own budget: with a single per-phone
// counter, five junk guesses from anywhere killed the victim's freshly-issued code, and
// combined with the 3-codes-per-hour issue cap that was a cheap, targeted login lockout.
export const MAX_VERIFY_ATTEMPTS_PER_IP = 5;
// Brute-force backstop across ALL IPs for one code: past this the code itself is killed.
// 6 digits / 30 guesses = a 0.003% success chance per issued code even from a botnet, while
// a targeted lockout now costs the attacker 6+ distinct IPs per victim login instead of one.
export const MAX_VERIFY_ATTEMPTS_PER_PHONE = 30;

export interface IssuedOtp {
  code: string;
  /**
   * How long the code stays valid. Returned to the client rather than left for each
   * frontend to hardcode -- three separate login screens would otherwise each carry
   * their own copy of this number, free to drift from the real TTL enforced here.
   */
  expiresInSec: number;
  /**
   * How many further requests this phone may make inside the current rate window.
   * Surfaced so a client can warn before the last one instead of letting the user
   * discover the limit by getting locked out. Not a disclosure risk: the limiter is
   * keyed on the phone the caller already supplied and is applied whether or not an
   * account exists, so this reveals nothing about account existence.
   */
  resendsRemaining: number;
}

@Injectable()
export class OtpService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async issue(phone: string, ip: string): Promise<IssuedOtp> {
    // Checked (and its counter incremented) BEFORE the per-phone counter below, so a
    // request an abusive IP was going to be rejected for never burns any of that phone
    // number's own, unrelated resend quota.
    const ipKey = `otp:rl:ip:${ip}`;
    const ipCount = await this.redis.incr(ipKey);
    if (ipCount === 1) await this.redis.expire(ipKey, RATE_WINDOW_SEC);
    if (ipCount > IP_RATE_LIMIT_MAX) {
      throw new HttpException('Too many OTP requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    const rlKey = `otp:rl:${phone}`;
    const count = await this.redis.incr(rlKey);
    if (count === 1) await this.redis.expire(rlKey, RATE_WINDOW_SEC);
    if (count > RATE_LIMIT_MAX) {
      throw new HttpException('Too many OTP requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = randomInt(100000, 1000000).toString();
    await this.redis.set(`otp:${phone}`, code, 'EX', OTP_TTL_SEC);
    await this.redis.del(`otp:att:${phone}`, `otp:att:${phone}:${ip}`);
    return {
      code,
      expiresInSec: OTP_TTL_SEC,
      resendsRemaining: Math.max(0, RATE_LIMIT_MAX - count),
    };
  }

  async verify(phone: string, code: string, ip: string): Promise<boolean> {
    const key = `otp:${phone}`;
    const attemptsKey = `otp:att:${phone}`;
    const ipAttemptsKey = `otp:att:${phone}:${ip}`;
    const stored = await this.redis.get(key);
    if (!stored) return false;

    const ipAttempts = await this.redis.incr(ipAttemptsKey);
    if (ipAttempts === 1) await this.redis.expire(ipAttemptsKey, OTP_TTL_SEC);
    // This IP is done guessing for this code; the code itself stays alive for the owner.
    if (ipAttempts > MAX_VERIFY_ATTEMPTS_PER_IP) return false;

    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) await this.redis.expire(attemptsKey, OTP_TTL_SEC);
    if (attempts > MAX_VERIFY_ATTEMPTS_PER_PHONE) {
      await this.redis.del(key, attemptsKey, ipAttemptsKey);
      return false;
    }
    if (stored !== code) return false;

    await this.redis.del(key, attemptsKey, ipAttemptsKey);
    return true;
  }
}
