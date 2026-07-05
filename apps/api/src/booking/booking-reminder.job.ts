import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { PushService } from '../push/push.service';
import { SalonsService } from '../salons/salons.service';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { UsersService } from '../users/users.service';
import { Booking } from './booking.entity';

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
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    await this.run();
  }

  async run(): Promise<number> {
    const leadHours = await this.config.getReminderLeadHours();
    const now = new Date();
    const cutoff = new Date(now.getTime() + leadHours * 60 * 60_000);

    const due = await this.bookings.find({
      where: { status: 'confirmed', remindedAt: IsNull(), startsAt: LessThanOrEqual(cutoff) },
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

        const when = booking.startsAt.toISOString();
        await this.sms
          .send(customer.phone, `Reminder: your appointment at ${salon.name} is at ${when}. Address: ${salon.address}`)
          .catch(() => {});
        await this.push
          .sendToUser(customer.id, {
            title: 'Upcoming appointment',
            body: `${salon.name} — ${when}`,
          })
          .catch(() => {});
        remindedCount += 1;
      } catch (err) {
        // A single booking's lookup/notification failing (transient DB error, etc.) must not
        // abort processing of the rest of this tick's batch -- same reasoning as
        // PaymentReconciliationJob's per-item try/catch. The booking was already claimed
        // (remindedAt set) above, so it won't be retried on the next tick; log loudly so an
        // operator can follow up manually.
        this.logger.error(
          `Failed to send reminder for booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (remindedCount > 0) this.logger.log(`Sent ${remindedCount} appointment reminder(s)`);
    return remindedCount;
  }
}
