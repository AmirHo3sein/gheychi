import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { WalletService } from '../wallet/wallet.service';
import { Booking } from './booking.entity';
import { releaseBookingHold } from './booking-hold-release.util';

// Bounds one run's work per tick; anything left over is picked up on the next 1-minute
// tick -- same shape as ReferralGrantJob/StoryCleanupJob's own batch caps. Postgres has
// no native UPDATE ... LIMIT, hence the id-IN-subquery form.
const BATCH_SIZE = 1000;

@Injectable()
export class BookingExpiryJob {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly config: PlatformConfigService,
    private readonly walletService: WalletService,
    private readonly jobRunner: CronJobRunner,
  ) {}

  @Cron('*/1 * * * *')
  async handleCron(): Promise<void> {
    await this.jobRunner.run('booking-expiry', async () => {
      await this.run();
    });
  }

  async run(): Promise<number> {
    const ttlMinutes = await this.config.getBookingHoldTtlMinutes();
    const cutoff = new Date(Date.now() - ttlMinutes * 60_000);
    // RETURNING id + one transaction, rather than a bare UPDATE: an abandoned hold
    // that consumed a coupon code or wallet balance has to give them back (see
    // releaseBookingHold), and that needs the exact set of bookings this run
    // expired -- atomically with the expiry itself, so a crash between the two can't
    // leave a dead booking still holding its customer's code or balance hostage.
    return this.bookings.manager.transaction(async (em) => {
      const result = await em
        .createQueryBuilder()
        .update(Booking)
        .set({ status: 'expired' })
        .where('status = :status', { status: 'pending_payment' })
        .andWhere('created_at < :cutoff', { cutoff })
        .andWhere(
          `id IN (SELECT id FROM bookings WHERE status = :status AND created_at < :cutoff ORDER BY created_at ASC LIMIT :batchSize)`,
          { status: 'pending_payment', cutoff, batchSize: BATCH_SIZE },
        )
        .returning('id')
        .execute();
      const expiredIds = (result.raw as Array<{ id: string }>).map((row) => row.id);
      await releaseBookingHold(em, this.walletService, expiredIds);
      return expiredIds.length;
    });
  }
}
