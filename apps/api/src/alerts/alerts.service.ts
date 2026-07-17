import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { REDIS } from '../redis/redis.module';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';

// One alert per key per window. The refund-retry and reconciliation crons re-detect
// the same stuck condition every 5 minutes; without dedup a single stuck payment
// would page 288 times a day. Callers can widen the window per alert (dedupHours) --
// the stuck-refund escalation re-pages daily, not every 6 hours.
const ALERT_DEDUP_HOURS = 6;

// Global ceiling on alert SMS per hour. A mass incident (e.g. a Zarinpal outage
// stranding dozens of payments at once) raises many distinct keys, each past its
// own dedup -- this bounds the SMS cost. In-app notifications are free and are
// never capped.
const SMS_HOURLY_CAP_DEFAULT = 30;

export interface AlertInput {
  key: string; // dedup identity, per entity -- e.g. 'refund-stuck:<paymentId>'
  severity: 'critical' | 'warning'; // critical => also SMS the admin phone(s)
  title: string;
  body: string;
  link?: string; // optional admin-panel deep link
  dedupHours?: number; // per-alert dedup window override (default ALERT_DEDUP_HOURS)
}

/**
 * Operator paging for money-critical conditions. Every alert becomes an
 * admin-panel notification (type 'alert'); critical ones also SMS every phone
 * in ALERT_ADMIN_PHONE (comma-separated; empty/unset => SMS disabled, e.g.
 * local dev). raise() NEVER throws -- alerting must not be able to break a
 * payment path -- and fails open on Redis errors (a duplicate alert beats a
 * dropped one). When NOTHING was delivered (notification emit failed and no
 * SMS went out), the dedup claim is released so the next cron tick retries
 * instead of a transient failure muting the alert for the full window.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly smsHourlyCap: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly adminNotifications: AdminNotificationsService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly config: ConfigService,
  ) {
    const rawCap = this.config.get('ALERT_SMS_HOURLY_CAP', String(SMS_HOURLY_CAP_DEFAULT));
    const cap = Number(rawCap);
    if (Number.isFinite(cap) && cap > 0) {
      this.smsHourlyCap = cap;
    } else {
      this.smsHourlyCap = SMS_HOURLY_CAP_DEFAULT;
      this.logger.warn(
        `ALERT_SMS_HOURLY_CAP is set to ${JSON.stringify(rawCap)} which is not a positive number -- using the default (${SMS_HOURLY_CAP_DEFAULT})`,
      );
    }
  }

  async raise(input: AlertInput): Promise<void> {
    try {
      const dedupKey = `alert:dedup:${input.key}`;
      const dedupSeconds = (input.dedupHours ?? ALERT_DEDUP_HOURS) * 3600;
      const fresh = await this.redis.set(dedupKey, '1', 'EX', dedupSeconds, 'NX').catch((err) => {
        this.logger.error(
          `Alert dedup check failed for ${input.key} (failing open): ${err instanceof Error ? err.message : String(err)}`,
        );
        return 'OK' as const;
      });
      if (!fresh) return; // duplicate inside the window -- already alerted

      let emitted = true;
      await this.adminNotifications.emit('alert', input.title, input.body, input.link ?? null).catch((err) => {
        emitted = false;
        this.logger.error(
          `Alert notification emit failed for ${input.key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      let smsDelivered = 0;
      if (input.severity === 'critical') {
        const phones = String(this.config.get('ALERT_ADMIN_PHONE', ''))
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        for (const phone of phones) {
          if (!(await this.passesSmsHourlyCap(input.key))) break;
          const sent = await this.sms
            .send(phone, `${input.title} — ${input.body}`)
            .then(() => true)
            .catch((err) => {
              this.logger.error(
                `Alert SMS to ${phone} failed for ${input.key}: ${err instanceof Error ? err.message : String(err)}`,
              );
              return false;
            });
          if (sent) smsDelivered++;
        }
      }

      // Nothing reached an operator (no in-app row, no SMS) -- release the dedup
      // claim so the next 5-minute tick retries delivery rather than the alert
      // staying silent for the whole window. A partial success keeps the claim:
      // the in-app notification alone is a delivered alert.
      if (!emitted && smsDelivered === 0) {
        await this.redis.del(dedupKey).catch(() => {});
      }
    } catch (err) {
      // Belt-and-braces: nothing above should reach here, but a throw from raise()
      // inside a payment path would be worse than a lost alert.
      this.logger.error(`Alert raise failed for ${input.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Atomic INCR+EXPIRE on an hourly bucket; counts SMS send attempts. Fails
   * open (send anyway) on Redis errors, matching the dedup policy above --
   * a duplicate or excess SMS beats a silently dropped critical alert.
   */
  private async passesSmsHourlyCap(alertKey: string): Promise<boolean> {
    try {
      const hourBucket = Math.floor(Date.now() / 3_600_000);
      const replies = await this.redis
        .multi()
        .incr(`alert:sms-count:${hourBucket}`)
        .expire(`alert:sms-count:${hourBucket}`, 3600)
        .exec();
      const count = Number(replies?.[0]?.[1]);
      if (Number.isFinite(count) && count > this.smsHourlyCap) {
        this.logger.warn(
          `Alert SMS for ${alertKey} suppressed: hourly cap of ${this.smsHourlyCap} reached (in-app notification unaffected)`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(
        `Alert SMS hourly-cap check failed for ${alertKey} (failing open): ${err instanceof Error ? err.message : String(err)}`,
      );
      return true;
    }
  }
}
