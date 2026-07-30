import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { Booking } from './booking.entity';
import { releaseCouponRedemption } from './coupon-release.util';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';
import { Payment } from './payment.entity';

const STALE_AFTER_MINUTES = 20;

@Injectable()
export class PaymentReconciliationJob {
  private readonly logger = new Logger(PaymentReconciliationJob.name);

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly dataSource: DataSource,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly alerts: AlertsService,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    await this.run();
  }

  async run(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MINUTES * 60_000);
    const stale = await this.payments.find({
      where: { status: 'initiated', createdAt: LessThan(cutoff) },
    });

    let reconciled = 0;
    for (const payment of stale) {
      const authorities = await this.loadAuthorities(payment);
      if (authorities.length === 0) continue;
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
            // No capture ever happened, so give the customer back the coupon code this
            // hold consumed -- unconditional and idempotent, so it also covers the case
            // where the booking had already expired (BookingExpiryJob released it too).
            await releaseCouponRedemption(em, payment.bookingId);
          }
        });
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
