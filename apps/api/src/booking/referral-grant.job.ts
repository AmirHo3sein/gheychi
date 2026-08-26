import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { ReferralsService } from '../referrals/referrals.service';

// Bounds one run's work per bucket; anything left over is picked up on the next
// hourly tick -- same shape as StoryCleanupJob's CLEANUP_BATCH_SIZE.
const BATCH_SIZE = 200;

/**
 * The first-paid-booking referral trigger's sweep (R7). Unlike the first-completed-
 * booking trigger (wired inline into BookingsService.updateStatus), a paid-booking
 * grant needs a background pass because R7's grant_holdback_hours delay means "the
 * qualifying event fired" and "it's now safe to grant" are two different moments --
 * there is no later booking-side event to hang an inline call off of.
 *
 * Runs hourly, matching StoryCleanupJob's cadence -- a coarse "has enough time
 * plausibly passed" cadence is the right fit here (unlike RefundRetryJob/
 * PaymentReconciliationJob's 5-minute cadence, which exists to closely track a
 * payment gateway's live state). tryGrantReward itself performs the authoritative,
 * per-candidate age check (R7); this job's own SQL pre-filter only needs to be a
 * cheap, conservative superset.
 */
@Injectable()
export class ReferralGrantJob {
  private readonly logger = new Logger(ReferralGrantJob.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly referrals: ReferralsService,
    private readonly jobRunner: CronJobRunner,
    private readonly config: PlatformConfigService,
  ) {}

  @Cron('0 * * * *')
  async handleCron(): Promise<void> {
    await this.jobRunner.run('referral-grant', async () => {
      await this.run();
    });
  }

  async run(): Promise<number> {
    // Single choke point for this job's two sweeps -- a referral sitting in
    // awaiting_qualifying_event/partially_granted just stays there and gets evaluated
    // again on the next hourly tick once re-enabled, nothing is lost.
    const { referralsEnabled } = await this.config.getFeatureFlags();
    if (!referralsEnabled) return 0;

    let attempted = 0;
    attempted += await this.sweepAwaitingFirstPaidBooking();
    attempted += await this.sweepPartiallyGranted();
    return attempted;
  }

  /**
   * Referrals still awaiting a 'first_paid_booking' qualifying event, coarsely
   * pre-filtered to ones with at least one plausibly-old-enough 'paid' payment by
   * the referred user (scoped to the referring salon for salon_owner/worker types,
   * per R6 -- 'user'-type referrals accept a paid booking at any salon). The exact
   * age check against grant_holdback_hours is re-done authoritatively inside
   * tryGrantReward itself; this is only a cheap superset to avoid calling into the
   * full transaction for every still-waiting referral on every tick.
   */
  private async sweepAwaitingFirstPaidBooking(): Promise<number> {
    const candidates: Array<{ referred_user_id: string; salon_id: string | null }> = await this.dataSource.query(
      `
      SELECT r.referred_user_id, r.salon_id
      FROM referrals r
      WHERE r.status = 'awaiting_qualifying_event'
        AND r.qualifying_event = 'first_paid_booking'
        AND EXISTS (
          SELECT 1 FROM payments p
          JOIN bookings b ON b.id = p.booking_id
          WHERE b.user_id = r.referred_user_id
            AND p.status = 'paid'
            AND p.paid_at IS NOT NULL
            AND p.paid_at <= now() - (r.grant_holdback_hours || ' hours')::interval
            AND (r.salon_id IS NULL OR b.salon_id = r.salon_id)
        )
      ORDER BY r.created_at ASC
      LIMIT $1
      `,
      [BATCH_SIZE],
    );

    let attempted = 0;
    for (const candidate of candidates) {
      try {
        const bookingId = await this.resolveTriggeringBookingId(candidate.referred_user_id, candidate.salon_id);
        if (!bookingId) continue; // shouldn't happen given the EXISTS above, but defensive
        await this.referrals.tryGrantReward(candidate.referred_user_id, bookingId, 'paid');
        attempted++;
      } catch (err) {
        // Per-candidate isolation -- one bad row must not block the rest of the batch,
        // matching every other job in this codebase (RefundRetryJob, PaymentReconciliationJob).
        // tryGrantReward itself already never throws (it alerts internally); this only
        // guards the resolveTriggeringBookingId query above.
        this.logger.error(
          `Referral grant sweep failed for referred user ${candidate.referred_user_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return attempted;
  }

  /**
   * Referrals stuck 'partially_granted' -- one side already has a referral_rewards row,
   * the other side's grant attempt hasn't succeeded yet (as of Slice 6 this is only
   * defense-in-depth: an older partial grant from before all five kinds were supported,
   * or a future reward kind added without matching grant logic -- see
   * ReferralsService.tryGrantReward's own doc comment). Retried unconditionally every
   * tick (cheap -- tryGrantReward's own idempotency means an already-granted side just
   * re-skips), so this self-heals the moment whatever blocked the missing side is
   * resolved, with no separate migration or backfill needed. The triggering booking is
   * already known (qualifying_booking_id was set at the first, partial grant) -- no need
   * to re-resolve it.
   */
  private async sweepPartiallyGranted(): Promise<number> {
    const candidates: Array<{ referred_user_id: string; qualifying_booking_id: string; qualifying_event: string }> =
      await this.dataSource.query(
        `SELECT referred_user_id, qualifying_booking_id, qualifying_event
         FROM referrals WHERE status = 'partially_granted' ORDER BY created_at ASC LIMIT $1`,
        [BATCH_SIZE],
      );

    let attempted = 0;
    for (const candidate of candidates) {
      try {
        const eventType = candidate.qualifying_event === 'first_completed_booking' ? 'completed' : 'paid';
        await this.referrals.tryGrantReward(candidate.referred_user_id, candidate.qualifying_booking_id, eventType);
        attempted++;
      } catch (err) {
        this.logger.error(
          `Partially-granted referral retry failed for referred user ${candidate.referred_user_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return attempted;
  }

  /** The referred user's first 'paid' Payment's booking, ordered by paid_at ascending. */
  private async resolveTriggeringBookingId(referredUserId: string, salonId: string | null): Promise<string | null> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `
      SELECT b.id
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      WHERE b.user_id = $1 AND p.status = 'paid' AND ($2::uuid IS NULL OR b.salon_id = $2)
      ORDER BY p.paid_at ASC NULLS LAST
      LIMIT 1
      `,
      [referredUserId, salonId],
    );
    return rows[0]?.id ?? null;
  }
}
