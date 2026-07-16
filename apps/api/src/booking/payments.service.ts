import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PushService } from '../push/push.service';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { SalonsService } from '../salons/salons.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { Booking } from './booking.entity';
import { PAYMENT_GATEWAY, PaymentGateway, PaymentRefundResult } from './payment-gateway';
import { Payment } from './payment.entity';

export type CallbackOutcome = 'success' | 'failed' | 'already-confirmed';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly salonsService: SalonsService,
    private readonly usersService: UsersService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly push: PushService,
  ) {}

  async handleCallback(authority: string, status: string): Promise<{ status: CallbackOutcome; bookingId: string }> {
    const payment = await this.payments.findOneBy({ authority });
    if (!payment) throw new NotFoundException('Payment not found');

    if (payment.status === 'paid') {
      return { status: 'already-confirmed', bookingId: payment.bookingId };
    }
    if (payment.status !== 'initiated') {
      return { status: 'failed', bookingId: payment.bookingId };
    }

    if (status !== 'OK') {
      await this.markFailed(payment.id, payment.bookingId);
      return { status: 'failed', bookingId: payment.bookingId };
    }

    let verify: { success: boolean; refId: string | null };
    try {
      verify = await this.gateway.verifyPayment(authority, payment.amount);
    } catch (err) {
      // Left at 'initiated' on gateway failure (network error, Zarinpal outage) --
      // a later payment-reconciliation job re-verifies any 'initiated' payment
      // past a cutoff and will correctly transition it once Zarinpal is
      // reachable again (its own code 101 "already verified" makes a repeat
      // verify call safe), so this is self-healing, not a stuck state. Logged
      // so an unusually persistent outage is still visible to operators.
      this.logger.error(
        `Zarinpal verify threw for authority ${authority}, payment ${payment.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
    if (!verify.success) {
      await this.markFailed(payment.id, payment.bookingId);
      return { status: 'failed', bookingId: payment.bookingId };
    }

    // Zarinpal's callback is a browser redirect, not a server-issued webhook --
    // a back-button + refresh, a double-tap on "return to merchant", or an
    // in-app browser retry can genuinely deliver the same authority twice, with
    // a live network round-trip to verifyPayment above in between the two
    // calls' reads of payment.status. The conditional WHERE (status: 'initiated')
    // below means only the call that actually performs the initiated->paid
    // transition gets affected=1 and proceeds to notify; a losing concurrent
    // call sees affected=0 and skips notifyConfirmed, since the winner already
    // sent it -- this prevents a duplicate "booking confirmed" SMS without
    // needing a distributed lock, just Postgres's own row-level atomicity.
    const transitioned = await this.dataSource
      .transaction(async (em) => {
        const result = await em.update(
          Payment,
          { id: payment.id, status: 'initiated' },
          { status: 'paid', refId: verify.refId },
        );
        if (!result.affected) return false;
        await em.update(Booking, { id: payment.bookingId }, { status: 'confirmed' });
        return true;
      })
      .catch((err) => {
        // Zarinpal has already confirmed the charge at this point (verify.success
        // was true) -- if persisting that here fails, the payment is left at
        // 'initiated' even though Zarinpal genuinely captured the money. Same
        // self-healing story as the gateway-throw case above: the reconciliation
        // job re-verifies 'initiated' payments and will call verifyPayment
        // again, which resolves this -- but log it, since a stuck payment here
        // means a customer paid and doesn't yet see a confirmed booking.
        this.logger.error(
          `Failed to persist paid/confirmed state for authority ${authority}, payment ${payment.id}, booking ${payment.bookingId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      });

    if (transitioned) {
      await this.notifyConfirmed(payment.bookingId);
    }

    return { status: 'success', bookingId: payment.bookingId };
  }

  /**
   * The single consumer for refund_pending payments -- called inline by
   * BookingsService.cancel() right after its transaction commits, and by
   * RefundRetryJob for anything that slipped through. Never throws: a gateway
   * failure just leaves the payment refund_pending for the retry job's next
   * tick. Idempotent at both layers -- the conditional UPDATE means only one
   * concurrent attempt records the refund (and sends the one notification),
   * and the gateway treats a repeat refund of the same authority as success.
   */
  async attemptRefund(bookingId: string): Promise<'refunded' | 'pending' | 'skipped'> {
    const payment = await this.payments.findOneBy({ bookingId });
    if (!payment || payment.status !== 'refund_pending') return 'skipped';
    if (!payment.authority) {
      // Shouldn't occur -- a captured payment always has an authority -- but if it
      // does, an automatic refund is impossible and an operator has to step in.
      this.logger.error(`Payment ${payment.id} is refund_pending but has no authority -- needs manual refund`);
      return 'pending';
    }

    let result: PaymentRefundResult;
    try {
      result = await this.gateway.refundPayment(payment.authority);
    } catch (err) {
      this.logger.error(
        `Zarinpal refund threw for payment ${payment.id} (authority ${payment.authority}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'pending';
    }
    if (!result.success) {
      this.logger.error(`Zarinpal refused the refund for payment ${payment.id} (authority ${payment.authority}) -- will retry`);
      return 'pending';
    }

    const updated = await this.payments.update(
      { id: payment.id, status: 'refund_pending' },
      { status: 'refunded', refundRefId: result.refundRefId, refundedAt: new Date() },
    );
    // A losing concurrent attempt (inline cancel vs retry job) sees affected=0;
    // the winner already recorded the refund and sent the notification.
    if (!updated.affected) return 'skipped';

    await this.notifyRefunded(payment.bookingId);
    return 'refunded';
  }

  private async notifyRefunded(bookingId: string): Promise<void> {
    const booking = await this.bookings.findOneBy({ id: bookingId });
    if (!booking) return;
    const customer = await this.usersService.findById(booking.userId);
    if (!customer) return;
    await this.notifyOne(customer, 'مبلغ ودیعه نوبت شما بازگردانده شد.', {
      title: 'بازگشت وجه',
      body: 'مبلغ ودیعه نوبت شما بازگردانده شد.',
    });
  }

  private async markFailed(paymentId: string, bookingId: string): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await em.update(Payment, { id: paymentId }, { status: 'failed' });
      await em.update(Booking, { id: bookingId }, { status: 'cancelled_by_user' });
    });
  }

  private async notifyConfirmed(bookingId: string): Promise<void> {
    const booking = await this.bookings.findOneBy({ id: bookingId });
    if (!booking) return;
    const salon = await this.salonsService.findById(booking.salonId);
    if (!salon) return;
    const [customer, owner] = await Promise.all([
      this.usersService.findById(booking.userId),
      this.usersService.findById(salon.ownerId),
    ]);
    const when = booking.startsAt.toISOString();

    // SMS/push failures never roll back a confirmed booking (per the design spec's
    // error-handling section) -- these are best-effort notifications, not a queued-with-retry
    // system yet. The customer and owner notifications are independent of each other, so they
    // run concurrently to avoid stacking their latency onto the payment-callback response.
    await Promise.all([
      customer
        ? this.notifyOne(customer, `Booking confirmed at ${salon.name}, ${when}. Address: ${salon.address}`, {
            title: 'Booking confirmed',
            body: `${salon.name} — ${when}`,
          })
        : Promise.resolve(),
      owner
        ? this.notifyOne(owner, `New booking at ${salon.name} for ${when}`, {
            title: 'New booking',
            body: `${salon.name} — ${when}`,
          })
        : Promise.resolve(),
    ]);
  }

  private async notifyOne(user: User, smsBody: string, push: { title: string; body: string }): Promise<void> {
    await this.sms.send(user.phone, smsBody).catch(() => {});
    await this.push.sendToUser(user.id, push).catch(() => {});
  }
}
