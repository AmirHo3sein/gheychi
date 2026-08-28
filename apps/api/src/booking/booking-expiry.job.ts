import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { WalletService } from '../wallet/wallet.service';
import { Booking } from './booking.entity';
import { BookingEventsService } from './booking-events.service';
import { releaseBookingHold } from './booking-hold-release.util';
import { notifyAllBoundedly } from './expiry-notify.util';
import { PaymentsService } from './payments.service';

// Bounds one run's work per tick; anything left over is picked up on the next 1-minute
// tick -- same shape as ReferralGrantJob/StoryCleanupJob's own batch caps. Postgres has
// no native UPDATE ... LIMIT, hence the id-IN-subquery form.
const BATCH_SIZE = 1000;

@Injectable()
export class BookingExpiryJob {
  private readonly logger = new Logger(BookingExpiryJob.name);

  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly config: PlatformConfigService,
    private readonly walletService: WalletService,
    private readonly jobRunner: CronJobRunner,
    private readonly bookingEvents: BookingEventsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Cron('*/1 * * * *')
  async handleCron(): Promise<void> {
    await this.jobRunner.run(
      'booking-expiry',
      async () => {
        await this.run();
      },
      // 5-minute lock, not the 60s default: this job's own tick period is 60s and it now
      // does real per-booking work (notifications) after its transaction. A lock that
      // expires mid-run would let the next tick start a concurrent run -- harmless for the
      // expiry itself (the status CAS still protects that) but it would double-notify.
      { lockTtlMs: 5 * 60_000 },
    );
  }

  async run(): Promise<number> {
    // Still read for the LEGACY fallback only -- every booking created since
    // payment_expires_at shipped carries its own snapshotted deadline, and that
    // snapshot wins. This live-config cutoff now applies solely to rows predating
    // that column, which is why editing booking_hold_ttl_minutes no longer moves
    // the deadline of a hold that is already in flight.
    const ttlMinutes = await this.config.getBookingHoldTtlMinutes();
    const cutoff = new Date(Date.now() - ttlMinutes * 60_000);
    const now = new Date();

    // The two-armed predicate, written once and reused for both the UPDATE and its
    // LIMIT subquery so they can never disagree about which rows are due.
    const duePredicate = `(
      (payment_expires_at IS NOT NULL AND payment_expires_at <= :now)
      OR (payment_expires_at IS NULL AND created_at < :cutoff)
    )`;

    // RETURNING id + one transaction, rather than a bare UPDATE: an abandoned hold
    // that consumed a coupon code or wallet balance has to give them back (see
    // releaseBookingHold), and that needs the exact set of bookings this run
    // expired -- atomically with the expiry itself, so a crash between the two can't
    // leave a dead booking still holding its customer's code or balance hostage.
    const expired = await this.bookings.manager.transaction(async (em) => {
      const result = await em
        .createQueryBuilder()
        .update(Booking)
        .set({ status: 'expired' })
        .where('status = :status', { status: 'pending_payment' })
        .andWhere(duePredicate)
        .andWhere(
          `id IN (
            SELECT id FROM bookings
            WHERE status = :status AND ${duePredicate}
            ORDER BY created_at ASC LIMIT :batchSize
          )`,
          { status: 'pending_payment', now, cutoff, batchSize: BATCH_SIZE },
        )
        .setParameters({ status: 'pending_payment', now, cutoff, batchSize: BATCH_SIZE })
        // confirmation_mode comes back alongside the id because only manual-approval
        // bookings get a notification -- see the notification block below. Raw string
        // form, not the array form: the array form maps ENTITY PROPERTY names, so
        // 'confirmation_mode' would be silently dropped and every expiry would look
        // automatic (i.e. never notify anyone).
        .returning('id, confirmation_mode')
        .execute();
      const rows = result.raw as Array<{ id: string; confirmation_mode: string }>;
      const ids = rows.map((row) => row.id);
      await releaseBookingHold(em, this.walletService, ids);
      // One multi-row INSERT rather than 2 round-trips per booking -- at the 1000-row batch
      // cap that is the difference between a short transaction and a very long one.
      await this.bookingEvents.recordMany(
        ids.flatMap((id) => [
          { bookingId: id, eventType: 'PAYMENT_EXPIRED' as const, actorType: 'system' as const },
          {
            bookingId: id,
            eventType: 'SLOT_RELEASED' as const,
            actorType: 'system' as const,
            metadata: { cause: 'payment_expired' },
          },
        ]),
        em,
      );
      return rows;
    });

    // MANUAL-APPROVAL BOOKINGS ONLY. This is a deliberate SMS-budget rule, not an
    // oversight.
    //
    // An abandoned automatic checkout is a customer who opened the payment page and walked
    // away seconds ago -- they know they didn't pay, and texting every one of them would
    // spend real money to tell people something they already know. A manual-approval
    // booking is the opposite case: the customer was told "the salon accepted, you have
    // until HH:MM", then went about their day. Letting that window close silently is what
    // actually costs them a slot.
    //
    // Post-commit and per-booking isolated: the expiry is already durable, so a
    // notification failure must never roll it back or abort the rest of the batch.
    const notifiableIds = expired
      .filter((row) => row.confirmation_mode === 'manual_approval')
      .map((row) => row.id);
    await notifyAllBoundedly(
      notifiableIds,
      (id) => this.paymentsService.notifyPaymentExpired(id),
      (id, err) =>
        this.logger.error(
          `Failed to notify payment expiry of booking ${id}: ${err instanceof Error ? err.message : String(err)}`,
        ),
    );

    if (expired.length > 0) {
      this.logger.log(
        `booking.payment.window.expired count=${expired.length} notified=${notifiableIds.length} ` +
          `(automatic-mode expiries are deliberately not notified)`,
      );
    }

    return expired.length;
  }
}
