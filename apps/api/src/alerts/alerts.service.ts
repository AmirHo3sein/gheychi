import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';
import { REDIS } from '../redis/redis.module';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';

// One alert per key per window. The refund-retry and reconciliation crons re-detect
// the same stuck condition every 5 minutes; without dedup a single stuck payment
// would page 288 times a day.
const ALERT_DEDUP_HOURS = 6;

export interface AlertInput {
  key: string; // dedup identity, per entity -- e.g. 'refund-stuck:<paymentId>'
  severity: 'critical' | 'warning'; // critical => also SMS the admin phone
  title: string;
  body: string;
  link?: string; // optional admin-panel deep link
}

/**
 * Operator paging for money-critical conditions. Every alert becomes an
 * admin-panel notification (type 'alert'); critical ones also SMS
 * ALERT_ADMIN_PHONE (empty/unset => SMS disabled, e.g. local dev). raise()
 * NEVER throws -- alerting must not be able to break a payment path -- and
 * fails open on Redis errors (a duplicate alert beats a dropped one).
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly adminNotifications: AdminNotificationsService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly config: ConfigService,
  ) {}

  async raise(input: AlertInput): Promise<void> {
    try {
      const fresh = await this.redis
        .set(`alert:dedup:${input.key}`, '1', 'EX', ALERT_DEDUP_HOURS * 3600, 'NX')
        .catch((err) => {
          this.logger.error(
            `Alert dedup check failed for ${input.key} (failing open): ${err instanceof Error ? err.message : String(err)}`,
          );
          return 'OK' as const;
        });
      if (!fresh) return; // duplicate inside the window -- already alerted

      await this.adminNotifications.emit('alert', input.title, input.body, input.link ?? null).catch((err) => {
        this.logger.error(
          `Alert notification emit failed for ${input.key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      if (input.severity === 'critical') {
        const phone = this.config.get('ALERT_ADMIN_PHONE', '');
        if (phone) {
          await this.sms.send(phone, `${input.title} — ${input.body}`).catch((err) => {
            this.logger.error(
              `Alert SMS failed for ${input.key}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
      }
    } catch (err) {
      // Belt-and-braces: nothing above should reach here, but a throw from raise()
      // inside a payment path would be worse than a lost alert.
      this.logger.error(`Alert raise failed for ${input.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
