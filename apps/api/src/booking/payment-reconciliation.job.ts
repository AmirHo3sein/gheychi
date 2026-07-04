import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Booking } from './booking.entity';
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
      if (!payment.authority) continue;
      try {
        const verify = await this.gateway.verifyPayment(payment.authority, payment.amount);
        await this.dataSource.transaction(async (em) => {
          if (verify.success) {
            // The booking-hold TTL (15 min) is shorter than this job's stale
            // threshold (20 min), so by the time a payment is old enough to land
            // here, its booking has very likely ALREADY been expired by
            // BookingExpiryJob -- this is the common case, not a rare race.
            // Only resurrect a booking that's still genuinely pending_payment;
            // if it already moved on (expired, or cancelled by either party),
            // blindly flipping it back to confirmed would risk confirming a
            // slot that may have since been rebooked by someone else. The
            // payment still gets marked paid either way -- Zarinpal genuinely
            // captured the money -- but a booking that already left
            // pending_payment is logged for manual refund review instead of
            // being silently resurrected.
            const result = await em.update(
              Booking,
              { id: payment.bookingId, status: 'pending_payment' },
              { status: 'confirmed' },
            );
            if (!result.affected) {
              this.logger.error(
                `Payment ${payment.id} (authority ${payment.authority}) was confirmed by Zarinpal after its booking ${payment.bookingId} already left pending_payment -- needs manual refund review`,
              );
            }
            await em.update(Payment, { id: payment.id }, { status: 'paid', refId: verify.refId });
          } else {
            // Same reasoning in reverse: only cancel a booking that's still
            // pending_payment. If it already expired or was cancelled, there's
            // nothing left to do to it -- the payment simply gets marked failed
            // (Zarinpal never captured anything).
            await em.update(
              Booking,
              { id: payment.bookingId, status: 'pending_payment' },
              { status: 'cancelled_by_user' },
            );
            await em.update(Payment, { id: payment.id }, { status: 'failed' });
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
          `Failed to reconcile payment ${payment.id} (authority ${payment.authority}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return reconciled;
  }
}
