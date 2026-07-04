import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { Booking } from './booking.entity';

@Injectable()
export class BookingExpiryJob {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly config: PlatformConfigService,
  ) {}

  @Cron('*/1 * * * *')
  async handleCron(): Promise<void> {
    await this.run();
  }

  async run(): Promise<number> {
    const ttlMinutes = await this.config.getBookingHoldTtlMinutes();
    const cutoff = new Date(Date.now() - ttlMinutes * 60_000);
    const result = await this.bookings
      .createQueryBuilder()
      .update(Booking)
      .set({ status: 'expired' })
      .where('status = :status', { status: 'pending_payment' })
      .andWhere('created_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }
}
