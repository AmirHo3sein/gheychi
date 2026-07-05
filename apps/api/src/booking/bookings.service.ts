import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource, In, LessThan, MoreThan, Repository } from 'typeorm';
import { REDIS } from '../redis/redis.module';
import { SalonService } from '../salons/salon-service.entity';
import { Salon } from '../salons/salon.entity';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { Booking, BookingStatus } from './booking.entity';
import { CreateBookingDto } from './dto/booking.dto';
import { calculateDeposit } from './deposit.util';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';
import { Payment } from './payment.entity';

const LOCK_TTL_MS = 5000;

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    private readonly dataSource: DataSource,
    private readonly config: PlatformConfigService,
    private readonly nestConfig: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async createHold(userId: string, dto: CreateBookingDto): Promise<{ booking: Booking; paymentUrl: string }> {
    const salon = await this.salons.findOneBy({ id: dto.salonId, status: 'approved' });
    if (!salon) throw new NotFoundException('Salon not found');

    const service = await this.services.findOneBy({ id: dto.serviceId, salonId: dto.salonId, isActive: true });
    if (!service) throw new NotFoundException('Service not found');

    const startsAt = new Date(dto.startsAt);
    if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
      throw new BadRequestException('startsAt must be a valid future date-time');
    }
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);

    // Locked per-SALON, not per-exact-slot-instant. A salon offering services with
    // different durations can produce two bookings with different startsAt values
    // whose intervals still overlap (e.g. a 90-min booking at 09:00 and a 30-min
    // booking at 09:30) -- a lock keyed on the exact instant wouldn't serialize
    // those against each other, and under READ COMMITTED both transactions could
    // read the same (incomplete) overlap count before either commits. Locking the
    // whole salon means the entire check-then-insert critical section below is
    // fully serialized per salon regardless of duration or capacity, which is what
    // actually backs the "double booking is impossible" guarantee.
    const lockKey = `lock:booking:${dto.salonId}`;
    const acquired = await this.redis.set(lockKey, '1', 'PX', LOCK_TTL_MS, 'NX');
    if (!acquired) throw new ConflictException('This slot is being booked by someone else, try again');

    let booking: Booking;
    let depositAmount: number;
    try {
      const result = await this.dataSource.transaction(async (em) => {
        const overlapping = await em.count(Booking, {
          where: {
            salonId: dto.salonId,
            status: In(['pending_payment', 'confirmed']),
            startsAt: LessThan(endsAt),
            endsAt: MoreThan(startsAt),
          },
        });
        if (overlapping >= salon.capacity) throw new ConflictException('Slot no longer available');

        const depositPercent = await this.config.getDepositPercent();
        const depositMin = await this.config.getDepositMinToman();
        const deposit = calculateDeposit(service.price, depositPercent, depositMin);

        const savedBooking = await em.save(
          Booking,
          em.create(Booking, {
            userId,
            salonId: dto.salonId,
            serviceId: dto.serviceId,
            startsAt,
            endsAt,
            priceSnapshot: service.price,
            depositAmount: deposit,
            status: 'pending_payment',
          }),
        );
        await em.save(
          Payment,
          em.create(Payment, {
            bookingId: savedBooking.id,
            amount: deposit,
            gateway: 'zarinpal',
            status: 'initiated',
          }),
        );
        return { booking: savedBooking, depositAmount: deposit };
      });
      booking = result.booking;
      depositAmount = result.depositAmount;
    } finally {
      await this.redis.del(lockKey);
    }

    const paymentUrl = await this.createPaymentSession(booking, salon.name, depositAmount);
    return { booking, paymentUrl };
  }

  // Shared by createHold and retryPayment -- both need to obtain a fresh Zarinpal
  // authority/paymentUrl for a booking's deposit and persist that authority against
  // the booking's single Payment row so the callback can later reconcile it.
  private async createPaymentSession(booking: Booking, salonName: string, depositAmount: number): Promise<string> {
    const callbackUrl = `${this.nestConfig.getOrThrow('APP_BASE_URL')}/api/payments/callback`;
    const { authority, paymentUrl } = await this.gateway.requestPayment(
      depositAmount,
      `Booking deposit for ${salonName}`,
      callbackUrl,
    );
    try {
      await this.payments.update({ bookingId: booking.id }, { authority });
    } catch (err) {
      // Zarinpal already generated a real, chargeable authority at this point --
      // if persisting it fails, a later callback carrying this exact authority
      // has nothing to reconcile against (a later task looks bookings up by
      // authority). This can't be recovered here without holding the request
      // open for retries, so at minimum make it observable: log loudly with
      // enough detail for manual reconciliation, then let the original error
      // propagate as a 500 -- the customer never saw paymentUrl in this case,
      // so no money can move through the orphaned session.
      this.logger.error(
        `Failed to persist Zarinpal authority ${authority} for booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    return paymentUrl;
  }

  async retryPayment(userId: string, bookingId: string): Promise<{ paymentUrl: string }> {
    const booking = await this.bookings.findOneBy({ id: bookingId, userId });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'pending_payment') {
      throw new ConflictException('Booking is not awaiting payment');
    }

    const salon = await this.salons.findOneBy({ id: booking.salonId });
    if (!salon) throw new NotFoundException('Salon not found');

    const paymentUrl = await this.createPaymentSession(booking, salon.name, booking.depositAmount);
    return { paymentUrl };
  }

  async findMine(userId: string, id: string): Promise<Booking> {
    const booking = await this.bookings.findOneBy({ id, userId });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  listMine(userId: string): Promise<Booking[]> {
    return this.bookings.find({ where: { userId }, order: { startsAt: 'DESC' } });
  }

  async cancel(bookingId: string, callerId: string): Promise<Booking> {
    const booking = await this.bookings.findOneBy({ id: bookingId });
    if (!booking) throw new NotFoundException('Booking not found');
    const cancellableStatuses: BookingStatus[] = ['pending_payment', 'confirmed'];
    if (!cancellableStatuses.includes(booking.status)) {
      throw new BadRequestException('Booking cannot be cancelled in its current state');
    }

    const salon = await this.salons.findOneBy({ id: booking.salonId });
    if (!salon) throw new NotFoundException('Salon not found');

    const isCustomer = booking.userId === callerId;
    const isOwner = salon.ownerId === callerId;
    if (!isCustomer && !isOwner) throw new ForbiddenException('You cannot cancel this booking');

    let newBookingStatus: 'cancelled_by_user' | 'cancelled_by_salon';
    let refund: boolean;

    if (isOwner) {
      newBookingStatus = 'cancelled_by_salon';
      refund = true;
    } else {
      const cancellationWindowHours = await this.config.getCancellationWindowHours();
      const hoursUntilStart = (booking.startsAt.getTime() - Date.now()) / (1000 * 60 * 60);
      newBookingStatus = 'cancelled_by_user';
      refund = hoursUntilStart >= cancellationWindowHours;
    }

    await this.dataSource.transaction(async (em) => {
      // Guard against a concurrent cancel() call on the same booking -- a
      // genuinely plausible race, since the customer and the salon owner can
      // both hit "cancel" around the same moment (or a client can retry).
      // Without this, both transactions would read the same pre-cancellation
      // status above, both pass the check, and whichever commits last would
      // silently overwrite the other's outcome -- including making a caller's
      // own HTTP response reflect a status/refund decision that isn't actually
      // the one persisted. Conditioning the update on the status still being
      // cancellable means only the winner's write lands; the loser gets
      // affected=0 and a clear 409 instead of a misleading 200.
      const result = await em.update(
        Booking,
        { id: booking.id, status: In(cancellableStatuses) },
        { status: newBookingStatus },
      );
      if (!result.affected) {
        throw new ConflictException('Booking status changed before this cancellation could be applied');
      }
      // A pending_payment booking never had a captured payment -- nothing to refund
      // or forfeit, so its payment is simply marked failed. A confirmed booking's
      // deposit was genuinely captured; `refund` decides the payment's fate. Marking
      // `refunded` here only records our own intent -- no real Zarinpal refund API
      // call is made (see this plan's header note on why that's out of scope).
      if (booking.status === 'confirmed') {
        await em.update(Payment, { bookingId: booking.id }, { status: refund ? 'refunded' : 'paid' });
      } else {
        await em.update(Payment, { bookingId: booking.id }, { status: 'failed' });
      }
    });

    return (await this.bookings.findOneBy({ id: booking.id }))!;
  }

  listForSalon(salonId: string): Promise<Booking[]> {
    return this.bookings.find({ where: { salonId }, order: { startsAt: 'DESC' } });
  }

  async updateStatus(salonId: string, bookingId: string, status: 'completed' | 'no_show'): Promise<Booking> {
    const booking = await this.bookings.findOneBy({ id: bookingId, salonId });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'confirmed') {
      throw new BadRequestException('Only confirmed bookings can be marked completed or no-show');
    }
    // Both outcomes leave the payment `paid` -- a no-show forfeits the deposit to the
    // salon (no refund), and a completion's deposit is deducted from the in-salon total,
    // tracked outside this system for MVP. Neither calls a real payout/refund API; see
    // this plan's header note on why that's explicitly out of scope.
    //
    // Guard against a concurrent write on the same booking -- most notably cancel(),
    // which can run at the same moment a provider marks a booking completed/no-show.
    // Without this, an unconditional update could silently flip an already-cancelled-
    // and-refunded booking's status back to completed/no_show if the two requests
    // interleave. Conditioning on the status still being confirmed (the same pattern
    // already used by cancel() and the payment callback) means only the winner's
    // write lands; a losing concurrent call gets a clear 409 instead.
    const result = await this.bookings.update({ id: bookingId, status: 'confirmed' }, { status });
    if (!result.affected) {
      throw new ConflictException('Booking status changed before this update could be applied');
    }
    return (await this.bookings.findOneBy({ id: bookingId }))!;
  }
}
