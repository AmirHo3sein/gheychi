import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
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
      }
      // attemptRefund never throws (it catches gateway errors internally), so one bad
      // payment can't block the rest of the batch.
      const outcome = await this.paymentsService.attemptRefund(payment.bookingId);
      if (outcome === 'refunded') refunded++;
    }
    return refunded;
  }
}
