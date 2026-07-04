import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource, In, LessThan, MoreThan, Repository } from 'typeorm';
import { REDIS } from '../redis/redis.module';
import { SalonService } from '../salons/salon-service.entity';
import { Salon } from '../salons/salon.entity';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { Booking } from './booking.entity';
import { CreateBookingDto } from './dto/booking.dto';
import { calculateDeposit } from './deposit.util';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';
import { Payment } from './payment.entity';

const LOCK_TTL_MS = 5000;

@Injectable()
export class BookingsService {
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

    const callbackUrl = `${this.nestConfig.getOrThrow('APP_BASE_URL')}/api/payments/callback`;
    const { authority, paymentUrl } = await this.gateway.requestPayment(
      depositAmount,
      `Booking deposit for ${salon.name}`,
      callbackUrl,
    );
    await this.payments.update({ bookingId: booking.id }, { authority });

    return { booking, paymentUrl };
  }

  async findMine(userId: string, id: string): Promise<Booking> {
    const booking = await this.bookings.findOneBy({ id, userId });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  listMine(userId: string): Promise<Booking[]> {
    return this.bookings.find({ where: { userId }, order: { startsAt: 'DESC' } });
  }
}
