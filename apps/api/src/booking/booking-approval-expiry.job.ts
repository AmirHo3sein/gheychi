import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { WalletService } from '../wallet/wallet.service';
import { Booking } from './booking.entity';
import { BookingEventsService } from './booking-events.service';
import { releaseBookingHold } from './booking-hold-release.util';
import { notifyAllBoundedly } from './expiry-notify.util';
import { PaymentsService } from './payments.service';

// Same cap and rationale as BookingExpiryJob's: bound one tick's work, let the next
// minute pick up any remainder.
const BATCH_SIZE = 1000;

/**
 * Retires manual-approval requests the salon never answered.
 *
 * `pending_approval -> expired`. Deliberately the SAME terminal status an unpaid hold
 * gets, not a bespoke one: from the customer's and the availability engine's point of
 * view these are the same outcome (the request died without becoming an appointment),
 * and giving it a separate status would fork every downstream status check for no gain.
 * What actually happened is recorded losslessly in booking_events (APPROVAL_EXPIRED).
 *
 * No refund is ever owed here -- a pending_approval booking has no Payment row at all by
 * construction (see BookingsService.createHold), which is the entire point of taking
 * payment after approval rather than before.
 */
@Injectable()
export class BookingApprovalExpiryJob {
  private readonly logger = new Logger(BookingApprovalExpiryJob.name);

  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly walletService: WalletService,
    private readonly jobRunner: CronJobRunner,
    private readonly bookingEvents: BookingEventsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Cron('*/1 * * * *')
  async handleCron(): Promise<void> {
    await this.jobRunner.run(
      'booking-approval-expiry',
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
    const now = new Date();

    const expiredIds = await this.bookings.manager.transaction(async (em) => {
      // The `WHERE status = 'pending_approval'` on the UPDATE itself IS the CAS: a
      // request the salon approved or rejected between the subquery and the update is
      // excluded by the outer predicate, so a cron tick can never overwrite a real
      // human decision. Idempotent by construction -- a second run finds nothing.
      const result = await em
        .createQueryBuilder()
        .update(Booking)
        .set({ status: 'expired' })
        .where('status = :status', { status: 'pending_approval' })
        .andWhere('approval_expires_at IS NOT NULL AND approval_expires_at <= :now')
        .andWhere(
          `id IN (
            SELECT id FROM bookings
            WHERE status = :status AND approval_expires_at IS NOT NULL AND approval_expires_at <= :now
            ORDER BY approval_expires_at ASC LIMIT :batchSize
          )`,
        )
        .setParameters({ status: 'pending_approval', now, batchSize: BATCH_SIZE })
        .returning('id')
        .execute();

      const ids = (result.raw as Array<{ id: string }>).map((row) => row.id);
      // Nothing was captured, but the request may well have staked a coupon code and
      // wallet balance at creation -- the same "died before capture" giveback every
      // other such path uses. Without this a customer whose request the salon simply
      // ignored would lose their single-use code for good.
      await releaseBookingHold(em, this.walletService, ids);
      // One multi-row INSERT rather than 2 round-trips per booking -- see recordMany.
      await this.bookingEvents.recordMany(
        ids.flatMap((id) => [
          { bookingId: id, eventType: 'APPROVAL_EXPIRED' as const, actorType: 'system' as const },
          {
            bookingId: id,
            eventType: 'SLOT_RELEASED' as const,
            actorType: 'system' as const,
            metadata: { cause: 'approval_expired' },
          },
        ]),
        em,
      );
      return ids;
    });

    if (expiredIds.length > 0) {
      this.logger.log(
        `booking.approval.expired count=${expiredIds.length} from=pending_approval to=expired actor=system ` +
          `bookingIds=${expiredIds.join(',')}`,
      );
    }

    await notifyAllBoundedly(
      expiredIds,
      (id) => this.paymentsService.notifyApprovalExpired(id),
      (id, err) =>
        this.logger.error(
          `Failed to notify approval expiry of booking ${id}: ${err instanceof Error ? err.message : String(err)}`,
        ),
    );

    return expiredIds.length;
  }
}
