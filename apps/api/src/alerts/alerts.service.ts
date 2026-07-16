import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';

const THROTTLE_KEY_PREFIX = 'ops-alert:';
const HOURLY_COUNT_KEY_PREFIX = 'ops-alert:count:';
const DEFAULT_THROTTLE_HOURS = 6;
const DEFAULT_HOURLY_CAP = 30;
const PHONE_PATTERN = /^09\d{9}$/;

/**
 * Pages a human operator (SMS via the existing SmsProvider) about conditions
 * that cannot self-heal. Deliberately NOT a new provider abstraction -- it
 * composes the existing SMS_PROVIDER and REDIS tokens; an alert-channel
 * interface gets added when a second channel actually exists, not before.
 *
 * Message content rule: alert text carries internal IDs and timestamps only
 * (payment id, booking id, condition tag) -- never customer phone numbers,
 * amounts, OTPs, or tokens. SMS is not a secure sink.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly phones: string[];
  private readonly defaultTtlSeconds: number;
  private readonly hourlyCap: number;
  // Redis-outage fallback: per-process at-most-once-per-TTL, instead of either
  // spamming every job tick or going silent while Redis is down.
  private readonly localThrottle = new Map<string, number>();

  constructor(
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService,
  ) {
    const raw: string = config.get('OPS_ALERT_PHONES', '');
    const entries = raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    this.phones = entries.filter((p) => PHONE_PATTERN.test(p));
    this.defaultTtlSeconds = Math.round(this.positiveNumberConfig(config, 'OPS_ALERT_THROTTLE_HOURS', DEFAULT_THROTTLE_HOURS) * 3600);
    this.hourlyCap = this.positiveNumberConfig(config, 'OPS_ALERT_HOURLY_CAP', DEFAULT_HOURLY_CAP);

    if (entries.length > 0 && this.phones.length === 0) {
      this.logger.warn('OPS_ALERT_PHONES is set but contains no parseable 09x phone numbers -- ops alerting is effectively disabled');
    }
    if (this.phones.length > 0 && config.get('SMS_PROVIDER') !== 'kavenegar') {
      this.logger.warn('OPS_ALERT_PHONES is set but SMS_PROVIDER is not kavenegar -- ops alerts will only print to logs');
    }
  }

  /**
   * Reads a numeric config value defensively: anything that is not a finite
   * positive number (unparseable, empty string -- Number('') === 0 -- zero,
   * negative) falls back to the built-in default with a boot-time warning,
   * instead of silently disabling throttling or suppressing every alert.
   */
  private positiveNumberConfig(config: ConfigService, key: string, fallback: number): number {
    const raw = config.get(key, fallback);
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
    this.logger.warn(`${key} is set but is not a positive number ('${String(raw)}') -- falling back to the default (${fallback})`);
    return fallback;
  }

  /**
   * Fire an operator alert, throttled per dedupeKey. Never throws, never
   * rejects -- every failure path logs and returns; the caller's own
   * logger.error line remains the source of truth for the condition.
   */
  async notifyOps(dedupeKey: string, message: string, opts?: { ttlSeconds?: number }): Promise<void> {
    try {
      if (this.phones.length === 0) {
        this.logger.warn(`[unrouted ops alert] ${message}`);
        return;
      }

      const ttlSeconds = opts?.ttlSeconds ?? this.defaultTtlSeconds;
      if (!(await this.passesThrottle(dedupeKey, ttlSeconds))) return;
      if (!(await this.passesHourlyCap(dedupeKey))) {
        // Cap suppression delivered nothing, same as the all-sends-fail path
        // below: release the throttle claim so the next job tick retries once
        // the capped hour rolls over, instead of the alert staying muted for
        // its full TTL.
        this.localThrottle.delete(dedupeKey);
        await this.redis.del(THROTTLE_KEY_PREFIX + dedupeKey).catch(() => {});
        return;
      }

      let delivered = 0;
      for (const phone of this.phones) {
        try {
          await this.sms.send(phone, `[Arayeshgah] ${message}`);
          delivered++;
        } catch (err) {
          this.logger.error(
            `Failed to send ops alert (${dedupeKey}) to ${phone}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      // Every send failed (e.g. a transient Kavenegar blip): release the
      // throttle so the next job tick retries delivery instead of the alert
      // being muted for the full TTL. A partial success keeps the key -- at
      // least one operator was paged.
      if (delivered === 0) {
        this.localThrottle.delete(dedupeKey);
        await this.redis.del(THROTTLE_KEY_PREFIX + dedupeKey).catch(() => {});
      }
    } catch (err) {
      this.logger.error(`notifyOps failed for ${dedupeKey}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** True when this dedupeKey has not alerted inside its TTL window. */
  private async passesThrottle(dedupeKey: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await this.redis.set(THROTTLE_KEY_PREFIX + dedupeKey, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (err) {
      this.logger.warn(
        `Redis unavailable for ops-alert throttle (${dedupeKey}), using in-process fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      const now = Date.now();
      const expiresAt = this.localThrottle.get(dedupeKey);
      if (expiresAt !== undefined && expiresAt > now) return false;
      this.localThrottle.set(dedupeKey, now + ttlSeconds * 1000);
      return true;
    }
  }

  /**
   * Global SMS-per-hour circuit breaker -- bounds worst-case SMS cost in a
   * mass incident. Breaker errors are non-fatal: on a Redis failure the send
   * proceeds (a missed cap is better than a missed page).
   */
  private async passesHourlyCap(dedupeKey: string): Promise<boolean> {
    try {
      const countKey = HOURLY_COUNT_KEY_PREFIX + Math.floor(Date.now() / 3_600_000);
      // INCR and EXPIRE run atomically so a crash between the two can never
      // leak a counter key with no TTL. Re-setting the expiry on every call is
      // harmless -- the bucket key changes every hour anyway.
      const replies = await this.redis.multi().incr(countKey).expire(countKey, 3600).exec();
      const count = Number(replies?.[0]?.[1]);
      if (count > this.hourlyCap) {
        this.logger.warn(`Ops alert hourly cap (${this.hourlyCap}) exceeded -- suppressing alert ${dedupeKey}`);
        return false;
      }
    } catch {
      // non-fatal by design
    }
    return true;
  }
}
