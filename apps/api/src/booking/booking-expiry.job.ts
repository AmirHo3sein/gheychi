import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { WalletService } from '../wallet/wallet.service';
import { Booking } from './booking.entity';
import { releaseBookingHold } from './booking-hold-release.util';

@Injectable()
export class BookingExpiryJob {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly config: PlatformConfigService,
    private readonly walletService: WalletService,
  ) {}

  @Cron('*/1 * * * *')
  async handleCron(): Promise<void> {
    await this.run();
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
        .returning('id')
        .execute();
      const expiredIds = (result.raw as Array<{ id: string }>).map((row) => row.id);
      await releaseBookingHold(em, this.walletService, expiredIds);
      return expiredIds.length;
    });
  }
}
