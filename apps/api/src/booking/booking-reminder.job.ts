import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { formatIranDateTimeFa } from '../common/iran-time.util';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PushService } from '../push/push.service';
import { SalonsService } from '../salons/salons.service';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { UsersService } from '../users/users.service';
import { Booking } from './booking.entity';

// Bounds one run's work per tick; anything left over is picked up on the next 5-minute
// tick -- same shape as ReferralGrantJob/StoryCleanupJob's own batch caps.
const BATCH_SIZE = 500;

@Injectable()
export class BookingReminderJob {
  private readonly logger = new Logger(BookingReminderJob.name);

  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly config: PlatformConfigService,
    private readonly salonsService: SalonsService,
    private readonly usersService: UsersService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly push: PushService,
    private readonly alerts: AlertsService,
    private readonly jobRunner: CronJobRunner,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    await this.jobRunner.run('booking-reminder', async () => {
      await this.run();
    });
  }

  async run(): Promise<number> {
    const leadHours = await this.config.getReminderLeadHours();
    const now = new Date();
    const cutoff = new Date(now.getTime() + leadHours * 60 * 60_000);

    const due = await this.bookings.find({
      where: { status: 'confirmed', remindedAt: IsNull(), startsAt: LessThanOrEqual(cutoff) },
      take: BATCH_SIZE,
    });

    let remindedCount = 0;
    for (const booking of due) {
      if (booking.startsAt <= now) continue; // don't remind about a booking that already started

      // Conditional update guards against this job double-reminding the same booking if
      // two ticks overlap (or in a future multi-instance deployment) -- same pattern as the
      // affected-count guards used throughout the booking module for concurrent status writes.
      const claim = await this.bookings.update(
        { id: booking.id, remindedAt: IsNull() },
        { remindedAt: now },
      );
      if (!claim.affected) continue;

      try {
        const salon = await this.salonsService.findById(booking.salonId);
        if (!salon) {
          this.logger.warn(`Booking ${booking.id} claimed for reminder but salon ${booking.salonId} was not found`);
          continue;
        }
        const customer = await this.usersService.findById(booking.userId);
        if (!customer) {
          this.logger.warn(`Booking ${booking.id} claimed for reminder but user ${booking.userId} was not found`);
          continue;
        }

        const when = formatIranDateTimeFa(booking.startsAt);
        // PushService.sendToUser is a documented best-effort no-throw call (it swallows
        // every per-subscription failure internally, and "no subscriptions" also looks
        // like success) -- it can never report a real delivery failure back to us, so it
        // is fired without gating the claim on it. sms.send() is the one channel here
        // that genuinely throws on failure, so it's the only reliable delivery signal:
        // before this fix, an SMS failure was swallowed via a blind `.catch(() => {})`
        // with zero logging or alerting, while the booking was still permanently marked
        // reminded (see the claim above) -- silently losing the reminder for good.
        await this.push
          .sendToUser(customer.id, { title: 'یادآوری نوبت', body: `${salon.name} — ${when}` })
          .catch(() => {});

        const smsOk = await this.sms
          .send(customer.phone, `یادآوری: نوبت شما در ${salon.name} ساعت ${when} است. آدرس: ${salon.address}`)
          .then(() => true)
          .catch((err) => {
            this.logger.error(
              `Reminder SMS failed for booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return false;
          });

        if (!smsOk) {
          // Release the claim (CAS-guarded on the exact timestamp we set it to, so this
          // can never clobber a claim some other run took afterward) so the booking is
          // picked up again next tick. Naturally bounded: once startsAt passes, the
          // top-of-loop guard stops retrying it.
          await this.bookings.update({ id: booking.id, remindedAt: now }, { remindedAt: null });
          await this.alerts.raise({
            key: `reminder-failed:${booking.id}`,
            severity: 'warning',
            title: 'ارسال یادآوری رزرو ناموفق بود',
            body: `ارسال پیامک یادآوری برای رزرو ${booking.id} ناموفق بود؛ در اجرای بعدی دوباره تلاش می‌شود.`,
          });
          continue;
        }

        remindedCount += 1;
      } catch (err) {
        // A single booking's lookup failing (transient DB error, etc.) must not abort
        // processing of the rest of this tick's batch -- same reasoning as
        // PaymentReconciliationJob's per-item try/catch. The booking was already claimed
        // (remindedAt set) above; unlike a delivery failure this is a lookup-layer error
        // with no clear single retry point, so it's logged loudly for manual follow-up
        // rather than auto-reverted.
        this.logger.error(
          `Failed to send reminder for booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (remindedCount > 0) this.logger.log(`Sent ${remindedCount} appointment reminder(s)`);
    return remindedCount;
  }
}
