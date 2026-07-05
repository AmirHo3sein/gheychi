import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PushService } from '../push/push.service';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { SalonsService } from '../salons/salons.service';
import { UsersService } from '../users/users.service';
import { Booking } from './booking.entity';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';
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
    // system yet.
    if (customer) {
      await this.sms.send(customer.phone, `Booking confirmed at ${salon.name}, ${when}. Address: ${salon.address}`).catch(() => {});
      await this.push.sendToUser(customer.id, {
        title: 'Booking confirmed',
        body: `${salon.name} — ${when}`,
      });
    }
    if (owner) {
      await this.sms.send(owner.phone, `New booking at ${salon.name} for ${when}`).catch(() => {});
      await this.push.sendToUser(owner.id, {
        title: 'New booking',
        body: `${salon.name} — ${when}`,
      });
    }
  }
}
