import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { CronJobRunner } from '../common/cron-job-runner.service';
import { WalletService } from '../wallet/wallet.service';
import { BookingEventsService } from './booking-events.service';
import { releaseBookingHold } from './booking-hold-release.util';
import { Booking } from './booking.entity';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';
import { Payment } from './payment.entity';
import { PaymentsService } from './payments.service';

const STALE_AFTER_MINUTES = 20;
// Bounds one run's work per tick -- each stale payment can involve a real network round
// trip to the payment gateway (per authority, possibly several), so an unbounded batch
// here is the single riskiest "expensive loop" among this codebase's cron jobs. Leftover
// payments are picked up on the next 5-minute tick; still 'initiated' in the meantime,
// exactly as before this cap existed.
const BATCH_SIZE = 200;

@Injectable()
export class PaymentReconciliationJob {
  private readonly logger = new Logger(PaymentReconciliationJob.name);

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly dataSource: DataSource,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly alerts: AlertsService,
    private readonly walletService: WalletService,
    private readonly jobRunner: CronJobRunner,
    // Appended at the end, matching this codebase's own constructor convention.
    private readonly bookingEvents: BookingEventsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    await this.jobRunner.run('payment-reconciliation', async () => {
      await this.run();
    });
  }

  async run(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000);
    // STALE_AFTER_MINUTES alone is NOT a sufficient staleness test any more.
    //
    // It used to be, by an unwritten coincidence: the payment window was one global
    // number (booking_hold_ttl_minutes, seeded 15), always shorter than these 20 minutes,
    // so any payment old enough to be selected here belonged to a booking BookingExpiryJob
    // had already killed -- and this job's `status = 'pending_payment'` guards therefore
    // never fired on a live booking.
    //
    // The payment window is now per-salon and admin-configurable up to 1440 minutes. A
    // salon with a 60-minute window would otherwise have every unpaid-but-still-valid
    // booking selected at minute 21, fail verification (the customer simply hasn't paid
    // yet), and be cancelled 39 minutes before the deadline the customer was shown.
    //
    // So a payment is stale only once its booking genuinely can't be paid for any more:
    // either the booking has already left pending_payment (the late-capture case this job
    // exists for), or its own snapshotted window has closed. Legacy rows with no snapshot
    // fall back to the original clock-only behaviour.
    const stale = await this.payments
      .createQueryBuilder('payment')
      .innerJoin(Booking, 'booking', 'booking.id = payment.bookingId')
      .where('payment.status = :status', { status: 'initiated' })
      .andWhere('payment.createdAt < :cutoff', { cutoff })
      .andWhere(
        `(booking.status <> 'pending_payment'
          OR booking.paymentExpiresAt IS NULL
          OR booking.paymentExpiresAt <= now())`,
      )
      // Deterministic, oldest-first: without it the batch cap could keep re-selecting the
      // same arbitrary 200 rows and starve the rest.
      .orderBy('payment.createdAt', 'ASC')
      .take(BATCH_SIZE)
      .getMany();

    let reconciled = 0;
    for (const payment of stale) {
      const authorities = await this.loadAuthorities(payment);
      if (authorities.length === 0) {
        // No authority was ever issued, so the gateway cannot possibly have captured
        // anything -- there is nothing to verify and nothing to refund. Before manual
        // approval existed this was near-impossible (createHold minted a session
        // milliseconds after inserting the row), so `continue` was harmless. Now
        // approve() inserts the Payment row when it opens the payment window, and a
        // customer who never clicks "pay" leaves it authority-less forever: it would be
        // re-selected on every tick, occupying a slot in every future batch until the
        // 200-row cap consisted entirely of rows that can never be resolved.
        //
        // Guarded on `authority IS NULL` as well as the status, so a customer who mints
        // a session in the same instant wins the race and keeps their live payment.
        const retired = await this.payments.update(
          { id: payment.id, status: 'initiated', authority: IsNull() },
          { status: 'failed' },
        );
        if (retired.affected) {
          this.logger.log(
            `Retired payment ${payment.id} (booking ${payment.bookingId}): no gateway session was ever opened for it`,
          );
          reconciled++;
        }
        continue;
      }
      try {
        // Every authority ever issued for this payment is re-verified, newest first --
        // not just payments.authority. retryPayment supersedes that column while the
        // customer's earlier Zarinpal tab stays chargeable, so a customer who paid
        // through the superseded session and never came back to the site would
        // otherwise be reconciled as a failure with their money still captured. The
        // first authority that verifies is the paying one; a verify that THROWS is left
        // to the outer catch (unknown state -- retried next tick), never treated as a
        // decline.
        const verified = await this.verifyAny(authorities, payment.amount);
        // Set inside the transaction, acted on after it commits: a booking this job is the
        // one to confirm (the callback never arrived -- the exact case this job exists for)
        // used to notify nobody and record no lifecycle event. The customer paid, the
        // booking became real, and neither party was ever told; the admin timeline showed a
        // booking that turned confirmed by magic.
        let confirmedHere = false;
        await this.dataSource.transaction(async (em) => {
          if (verified) {
            const result = await em.update(
              Booking,
              { id: payment.bookingId, status: 'pending_payment' },
              { status: 'confirmed' },
            );
            if (!result.affected) {
              // Zarinpal genuinely captured the money but the booking already moved
              // on (expired / cancelled) -- the customer must get it back. Queue an
              // automatic refund; RefundRetryJob performs it on its next tick.
              // Guarded on status 'initiated': if the customer's late callback won
              // the race (handleCallback confirmed the booking and marked the
              // payment paid between our verify and this transaction), affected is
              // 0 and we must NOT queue a refund for a live booking.
              const queued = await em.update(
                Payment,
                { id: payment.id, status: 'initiated' },
                {
                  status: 'refund_pending',
                  refId: verified.refId,
                  refundRequestedAt: new Date(),
                  // The session that actually captured, which is the one to refund --
                  // not necessarily the last one retryPayment minted.
                  authority: verified.authority,
                },
              );
              if (queued.affected) {
                this.logger.error(
                  `Payment ${payment.id} (authority ${verified.authority}) was confirmed by Zarinpal after its booking ${payment.bookingId} already left pending_payment -- queueing automatic refund`,
                );
                await this.alerts.raise({
                  key: `late-capture:${payment.id}`,
                  severity: 'warning',
                  title: 'پرداخت پس از انقضای رزرو',
                  body: `مبلغ پرداخت ${payment.id} پس از خروج رزرو ${payment.bookingId} از حالت انتظار دریافت شد؛ بازگشت وجه به‌صورت خودکار در صف قرار گرفت.`,
                });
              }
            } else {
              await em.update(
                Payment,
                { id: payment.id, status: 'initiated' },
                { status: 'paid', refId: verified.refId, paidAt: new Date(), authority: verified.authority },
              );
              await this.bookingEvents.record(
                {
                  bookingId: payment.bookingId,
                  eventType: 'PAYMENT_SUCCEEDED',
                  actorType: 'system',
                  metadata: { via: 'reconciliation', authority: verified.authority },
                },
                em,
              );
              await this.bookingEvents.record(
                {
                  bookingId: payment.bookingId,
                  eventType: 'BOOKING_CONFIRMED',
                  actorType: 'system',
                  metadata: { via: 'reconciliation' },
                },
                em,
              );
              confirmedHere = true;
            }
          } else {
            // Same reasoning in reverse: only cancel a booking that's still
            // pending_payment. If it already expired or was cancelled, there's
            // nothing left to do to it -- the payment simply gets marked failed
            // (Zarinpal never captured anything). The payment write carries the
            // same 'initiated' guard as the success branch: a late OK callback
            // can mark the payment paid between our verify returning failure and
            // this transaction committing, and clobbering that 'paid' to 'failed'
            // would vanish a genuinely captured deposit from earnings.
            await em.update(
              Booking,
              { id: payment.bookingId, status: 'pending_payment' },
              { status: 'cancelled_by_user' },
            );
            await em.update(Payment, { id: payment.id, status: 'initiated' }, { status: 'failed' });
            // No capture ever happened, so give the customer back the coupon code and
            // wallet balance this hold consumed -- unconditional and idempotent, so it
            // also covers the case where the booking had already expired (BookingExpiryJob
            // released it too).
            await releaseBookingHold(em, this.walletService, payment.bookingId);
          }
        });

        // Post-commit and best-effort, exactly like every other notification in this
        // codebase: the confirmation is already durable, so a failed SMS must never make
        // this payment look unreconciled and get retried on the next tick.
        if (confirmedHere) {
          try {
            await this.paymentsService.notifyConfirmed(payment.bookingId);
          } catch (notifyErr) {
            this.logger.error(
              `Reconciled booking ${payment.bookingId} but failed to notify it: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`,
            );
          }
        }
        reconciled++;
      } catch (err) {
        // A single payment's verify/DB call failing (network error, or an
        // authority that permanently errors against the gateway) must not
        // block reconciliation of every other stale payment queued after it
        // in this batch -- log and move on. This payment stays 'initiated'
        // and is retried on the next tick, same as before this run touched it.
        this.logger.error(
          `Failed to reconcile payment ${payment.id} (authorities ${authorities.join(', ')}): ${err instanceof Error ? err.message : String(err)}`,
        );
        await this.alerts.raise({
          key: `reconcile-failed:${payment.id}`,
          severity: 'warning',
          title: 'تطبیق پرداخت ناموفق',
          body: `تطبیق پرداخت ${payment.id} با خطا مواجه شد و در اجرای بعدی دوباره تلاش می‌شود.`,
        });
      }
    }
    return reconciled;
  }

  /**
   * Every Zarinpal session ever issued for this payment, newest first. payments.authority
   * only holds the most recent one -- retryPayment overwrites it -- while the superseded
   * sessions stay chargeable, so reconciling on the current authority alone can declare a
   * payment failed while the money sits captured on an older session. payment_authorities
   * (migration 1753700000000) is the append-only record; payments.authority is still
   * folded in as a fallback in case a row predates that ledger.
   */
  private async loadAuthorities(payment: Payment): Promise<string[]> {
    const rows = await this.payments.manager.query<Array<{ authority: string }>>(
      `SELECT authority FROM payment_authorities WHERE payment_id = $1 ORDER BY created_at DESC`,
      [payment.id],
    );
    const authorities = rows.map((row) => row.authority);
    if (payment.authority && !authorities.includes(payment.authority)) authorities.unshift(payment.authority);
    return authorities;
  }

  // First authority that Zarinpal confirms as captured, or null if it declines them all.
  private async verifyAny(
    authorities: string[],
    amount: number,
  ): Promise<{ authority: string; refId: string | null } | null> {
    for (const authority of authorities) {
      const verify = await this.gateway.verifyPayment(authority, amount);
      if (verify.success) return { authority, refId: verify.refId };
    }
    return null;
  }
}
