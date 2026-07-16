import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { Payment } from './payment.entity';
import { PaymentsService } from './payments.service';

// Skip refunds younger than this: the producing cancel() very likely just ran its own
// inline attemptRefund(), and giving that a head start keeps the (harmless, idempotent)
// double gateway call rare instead of routine.
const RETRY_GRACE_MINUTES = 2;
// A refund the gateway has refused/failed for a full day won't fix itself -- an operator
// needs to look at it (Zarinpal wallet balance, revoked access token, etc.).
const ESCALATE_AFTER_HOURS = 24;

@Injectable()
export class RefundRetryJob {
  private readonly logger = new Logger(RefundRetryJob.name);

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly paymentsService: PaymentsService,
    private readonly alerts: AlertsService,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    await this.run();
  }

  async run(): Promise<number> {
    const graceCutoff = new Date(Date.now() - RETRY_GRACE_MINUTES * 60_000);
    const pending = await this.payments.find({
      where: { status: 'refund_pending', refundRequestedAt: LessThan(graceCutoff) },
    });

    let refunded = 0;
    for (const payment of pending) {
      if (
        payment.refundRequestedAt &&
        Date.now() - payment.refundRequestedAt.getTime() > ESCALATE_AFTER_HOURS * 3_600_000
      ) {
        this.logger.error(
          `Payment ${payment.id} has been refund_pending since ${payment.refundRequestedAt.toISOString()} (over ${ESCALATE_AFTER_HOURS}h) -- needs operator attention`,
        );
        await this.alerts.raise({
          key: `refund-stuck:${payment.id}`,
          severity: 'critical',
          title: 'بازپرداخت معوق',
          body: `بازگشت وجه پرداخت ${payment.id} بیش از ${ESCALATE_AFTER_HOURS} ساعت در انتظار مانده است و نیاز به بررسی دستی دارد.`,
        });
      }
      // attemptRefund catches gateway failures internally, but a transient DB error
      // inside it can still throw -- one bad payment must not block the rest of the
      // batch (same per-payment isolation policy as the reconciliation job).
      try {
        const outcome = await this.paymentsService.attemptRefund(payment.bookingId);
        if (outcome === 'refunded') refunded++;
      } catch (err) {
        this.logger.error(
          `Refund retry failed for payment ${payment.id} (booking ${payment.bookingId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return refunded;
  }
}
