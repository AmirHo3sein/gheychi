import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { SalonsService } from '../salons/salons.service';
import { UsersService } from '../users/users.service';
import { Booking } from './booking.entity';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';
import { Payment } from './payment.entity';

export type CallbackOutcome = 'success' | 'failed' | 'already-confirmed';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly salonsService: SalonsService,
    private readonly usersService: UsersService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
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

    const verify = await this.gateway.verifyPayment(authority, payment.amount);
    if (!verify.success) {
      await this.markFailed(payment.id, payment.bookingId);
      return { status: 'failed', bookingId: payment.bookingId };
    }

    await this.dataSource.transaction(async (em) => {
      await em.update(Payment, { id: payment.id }, { status: 'paid', refId: verify.refId });
      await em.update(Booking, { id: payment.bookingId }, { status: 'confirmed' });
    });

    await this.notifyConfirmed(payment.bookingId);

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

    // SMS failures never roll back a confirmed booking (per the design spec's error-handling
    // section) -- this is a best-effort notification, not a queued-with-retry system yet.
    if (customer) {
      await this.sms.send(customer.phone, `Booking confirmed at ${salon.name}, ${when}. Address: ${salon.address}`).catch(() => {});
    }
    if (owner) {
      await this.sms.send(owner.phone, `New booking at ${salon.name} for ${when}`).catch(() => {});
    }
  }
}
