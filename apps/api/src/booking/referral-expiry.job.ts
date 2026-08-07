import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { CronJobRunner } from '../common/cron-job-runner.service';

// Bounds one run's work per tick; anything left over is picked up on the next hourly
// tick -- same shape as ReferralGrantJob/StoryCleanupJob's own batch caps.
const BATCH_SIZE = 500;

/**
 * Closes a real, previously-undetected gap: `referrals.status` has modeled `'expired'`
 * since the referral system shipped, and `expiresAt` is snapshotted onto every referral
 * row at redemption time (from the reward type's `expiration_days`, if configured) -- but
 * until this job, nothing ever actually swept for and applied it. A referral configured
 * with an expiration that never reached its qualifying event sat at
 * 'awaiting_qualifying_event' forever.
 *
 * Runs hourly, matching ReferralGrantJob/StoryCleanupJob's cadence -- expiry is not a
 * time-critical operation the way payment reconciliation is.
 */
@Injectable()
export class ReferralExpiryJob {
  private readonly logger = new Logger(ReferralExpiryJob.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly jobRunner: CronJobRunner,
  ) {}

  @Cron('0 * * * *')
  async handleCron(): Promise<void> {
    await this.jobRunner.run('referral-expiry', async () => {
      await this.run();
    });
  }

  async run(): Promise<number> {
    // A single conditional bulk UPDATE, not a select-then-loop: there is no per-row side
    // effect to perform (unlike ReferralGrantJob's tryGrantReward calls) and no
    // transaction needed beyond the statement's own atomicity. The WHERE clause is the
    // same CAS idiom used everywhere else in this codebase for a state transition --
    // `status = 'awaiting_qualifying_event'` is re-checked in the same statement as the
    // write, so a referral that ReferralGrantJob's own sweep grants (or partially grants)
    // in the instant between this job's candidate scan and its write can never be
    // incorrectly expired out from under it: the UPDATE simply matches zero rows for it.
    // Unlike a plain SELECT (which returns rows directly), dataSource.query() on an
    // UPDATE ... RETURNING resolves to a [rows, affectedCount] tuple -- only the first
    // element is the RETURNING rows.
    const [expiredRows]: [Array<{ id: string }>, number] = await this.dataSource.query(
      `
      UPDATE referrals
      SET status = 'expired'
      WHERE id IN (
        SELECT id FROM referrals
        WHERE status = 'awaiting_qualifying_event'
          AND expires_at IS NOT NULL
          AND expires_at < now()
        ORDER BY expires_at ASC
        LIMIT $1
      )
      RETURNING id
      `,
      [BATCH_SIZE],
    );
    if (expiredRows.length > 0) {
      this.logger.log(`Expired ${expiredRows.length} referral(s) past their expires_at.`);
    }
    return expiredRows.length;
  }
}
