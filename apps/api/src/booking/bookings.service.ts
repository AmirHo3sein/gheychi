import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource, In, LessThan, MoreThan, Repository } from 'typeorm';
import { AlertsService } from '../alerts/alerts.service';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { CouponRedemption } from '../coupons/coupon-redemption.entity';
import { CouponsService } from '../coupons/coupons.service';
import { REDIS } from '../redis/redis.module';
import { SalonService } from '../salons/salon-service.entity';
import { Salon } from '../salons/salon.entity';
import { Worker } from '../salons/worker.entity';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { ReferralsService } from '../referrals/referrals.service';
import { Booking, BookingStatus } from './booking.entity';
import { releaseCouponRedemption } from './coupon-release.util';
import { CreateBookingDto } from './dto/booking.dto';
import { calculateDeposit } from './deposit.util';
import { DiscountCandidate, resolveBestPriceWithWinner } from './discount.util';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';
import { Payment } from './payment.entity';
import { PaymentsService } from './payments.service';

const LOCK_TTL_MS = 5000;

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
    @InjectRepository(Worker) private readonly workers: Repository<Worker>,
    private readonly dataSource: DataSource,
    private readonly config: PlatformConfigService,
    private readonly nestConfig: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly paymentsService: PaymentsService,
    private readonly alerts: AlertsService,
    private readonly couponsService: CouponsService,
    private readonly referralsService: ReferralsService,
  ) {}

  async createHold(
    userId: string,
    dto: CreateBookingDto,
  ): Promise<{ booking: Booking; paymentUrl: string; couponApplied: boolean; paymentRequired: boolean }> {
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
    let couponApplied: boolean;
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

        // Passing `em` activates the row-lock/race-safety path inside
        // resolveAndValidate -- this is the real, money-moving redemption attempt,
        // not the read-only preview.
        const coupon = dto.couponCode
          ? await this.couponsService.resolveAndValidate(dto.couponCode, dto.salonId, userId, em)
          : null;
        // Best-discount-wins: if both a per-service discount and a coupon apply, the
        // one producing the LOWER resulting price is used -- they never stack/multiply.
        // A coupon is now either percent- or fixed-toman-kind (Slice 6); the service's
        // own discount is always percent-kind (unchanged). resolveBestPriceWithWinner
        // compares resulting prices across both kinds and also reports which single
        // candidate actually won, which is what decides which of the two mutually
        // exclusive audit columns below (discountPercent / discountFixedAmount) gets
        // populated on the booking.
        const serviceCandidate: DiscountCandidate =
          service.discountPercent !== null ? { kind: 'percent', value: service.discountPercent } : null;
        const couponCandidate: DiscountCandidate = coupon
          ? coupon.discountPercent !== null
            ? { kind: 'percent', value: coupon.discountPercent }
            : { kind: 'fixed', value: coupon.discountFixedAmount! }
          : null;
        const { finalPrice, winner } = resolveBestPriceWithWinner(service.price, [serviceCandidate, couponCandidate]);
        const discountPercent = winner?.kind === 'percent' ? winner.value : null;
        const discountFixedAmount = winner?.kind === 'fixed' ? winner.value : null;
        // A coupon that LOSES the comparison must not be spent. resolveBestPriceWithWinner
        // returns the winning candidate by identity, so this is the one honest test of
        // "did the code actually make the customer's price lower than the service's own
        // discount already did" -- presence of a valid coupon is not that test. Applying
        // a 10% code to a service already 30% off used to consume the code (permanently,
        // via UNIQUE(coupon_id, user_id)) for exactly zero benefit, and on a tie the
        // service discount wins, so the code survives for a booking where it can help.
        const couponApplied = coupon !== null && winner === couponCandidate;

        const depositPercent = await this.config.getDepositPercent();
        const depositMin = await this.config.getDepositMinToman();
        // Capped at finalPrice by calculateDeposit, so a fully-discounted booking (100%-off
        // coupon, or a fixed-amount referral coupon worth at least the price) lands on 0.
        const deposit = calculateDeposit(finalPrice, depositPercent, depositMin);
        // Nothing to collect => no gateway session and no Payment row at all, and the
        // booking is confirmed outright instead of being held in pending_payment. Sending
        // the customer to Zarinpal for 0 toman is not an option: the gateway rejects a
        // zero amount, which would 500 the booking request and leave a hold to expire.
        // A missing Payment row is already the "nothing was ever captured" case everywhere
        // that reads one -- cancel()'s payment UPDATE matches no row, attemptRefund()
        // skips, findMine()'s refundStatus stays null, getEarnings() counts nothing, and
        // the referral first_paid_booking trigger correctly never fires for a free booking
        // -- so this needs no special-casing outside createHold.
        const requiresPayment = deposit > 0;

        const savedBooking = await em.save(
          Booking,
          em.create(Booking, {
            userId,
            salonId: dto.salonId,
            serviceId: dto.serviceId,
            startsAt,
            endsAt,
            priceSnapshot: finalPrice,
            depositAmount: deposit,
            status: requiresPayment ? 'pending_payment' : 'confirmed',
            // Only the coupon that actually produced the price is recorded against the
            // booking -- a losing coupon was never applied to it in any sense.
            couponId: couponApplied ? coupon!.id : null,
            // Both service.discountPercent and coupon.discountPercent/discountFixedAmount
            // are DB-CHECK-constrained to be strictly positive whenever non-null, so
            // `winner` (if present) always carries a genuinely positive value here --
            // no need for the old ">0" guard now that presence is tracked explicitly.
            discountPercent,
            discountFixedAmount,
            originalPriceSnapshot: winner !== null ? service.price : null,
          }),
        );
        if (requiresPayment) {
          await em.save(
            Payment,
            em.create(Payment, {
              bookingId: savedBooking.id,
              amount: deposit,
              gateway: 'zarinpal',
              status: 'initiated',
            }),
          );
        }

        if (couponApplied) {
          try {
            await em.save(
              CouponRedemption,
              em.create(CouponRedemption, {
                couponId: coupon!.id,
                userId,
                bookingId: savedBooking.id,
                // In this branch the coupon IS the winner, so finalPrice is the price the
                // coupon itself produced -- service.price - finalPrice is the coupon's own
                // effect, not the service discount's. (Before the couponApplied gate above
                // this same expression credited the service discount's value to the coupon
                // whenever the service discount won, inflating usage reporting.)
                discountAmount: service.price - finalPrice,
              }),
            );
          } catch (err) {
            // The UNIQUE(coupon_id, user_id) constraint is the actual race-safety
            // backstop for "one redemption per user per code" -- resolveAndValidate's
            // own already-used check above is a best-effort pre-check that can lose a
            // genuine concurrent-request race, so this insert is where that race is
            // finally, authoritatively closed.
            if (isUniqueViolation(err)) throw new BadRequestException('شما قبلا از این کد تخفیف استفاده کرده‌اید');
            throw err;
          }
        }

        return { booking: savedBooking, depositAmount: deposit, couponApplied };
      });
      booking = result.booking;
      depositAmount = result.depositAmount;
      couponApplied = result.couponApplied;
    } finally {
      await this.redis.del(lockKey);
    }

    // A fully-discounted booking has nothing to charge for: it was committed as 'confirmed'
    // above, so there is no payment session to open. (couponApplied, returned by both
    // branches below, is false when no code was sent AND when a sent code lost to the
    // service's own discount -- the caller needs it to avoid telling the customer their code
    // was used when it wasn't; the booking's own price/discount columns already record what
    // was actually charged.)
    if (depositAmount === 0) {
      // Already 'confirmed' inside the transaction above. Send the same notifications the
      // payment callback sends on a confirmation -- otherwise the salon would never learn
      // about a free booking. Best-effort, exactly as in notifyConfirmed's own caller: the
      // booking is committed, so a notification failure must not surface as a failed
      // request (the customer would retry and double-book).
      try {
        await this.paymentsService.notifyConfirmed(booking.id);
      } catch (err) {
        this.logger.error(
          `Failed to notify the zero-deposit confirmation of booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // There is no gateway URL for a booking with nothing to pay, but the field is on the
      // wire and the user-app navigates to it unconditionally, so it points at the booking
      // itself -- the honest destination. Deliberately NOT the payment-callback page: that
      // page's success copy says the deposit was received, which would be a lie here.
      // `paymentRequired: false` is the explicit signal for clients that want to branch.
      const frontendBase = this.nestConfig.get('FRONTEND_BASE_URL', 'http://localhost:3003');
      return { booking, paymentUrl: `${frontendBase}/bookings/${booking.id}`, couponApplied, paymentRequired: false };
    }

    const paymentUrl = await this.createPaymentSession(booking, salon.name, depositAmount);
    return { booking, paymentUrl, couponApplied, paymentRequired: true };
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
      await this.dataSource.transaction(async (em) => {
        await em.update(Payment, { bookingId: booking.id }, { authority });
        // Append-only companion write: payments.authority holds only the CURRENT
        // session, so a retry used to orphan the previous one -- a customer paying
        // through their still-open first Zarinpal tab hit a 404 and their money was
        // recorded nowhere. payment_authorities keeps every authority ever issued so
        // PaymentsService can resolve any of them, and reconciliation can re-verify
        // all of them. Same transaction as the payments write, so the two can never
        // disagree about which sessions exist.
        //
        // Raw SQL by choice: this ledger is written here and read in exactly two
        // places, always by payment_id/authority, so an entity + repository (and its
        // module registration) would be pure ceremony. ON CONFLICT keeps the write
        // idempotent if the same session mint is ever replayed.
        await em.query(
          `INSERT INTO payment_authorities (payment_id, authority)
           SELECT id, $2 FROM payments WHERE booking_id = $1
           ON CONFLICT (authority) DO NOTHING`,
          [booking.id, authority],
        );
      });
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
      await this.alerts.raise({
        key: `authority-persist:${booking.id}`,
        severity: 'critical',
        title: 'شناسه پرداخت ثبت نشد',
        body: `شناسه پرداخت زرین‌پال برای رزرو ${booking.id} در پایگاه داده ثبت نشد و نیاز به تطبیق دستی دارد.`,
      });
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

  async findMine(
    userId: string,
    id: string,
  ): Promise<
    Booking & { salonName: string; serviceName: string; workerName: string | null; refundStatus: 'pending' | 'done' | null }
  > {
    const booking = await this.bookings.findOneBy({ id, userId });
    if (!booking) throw new NotFoundException('Booking not found');
    const [withNames] = await this.attachNames([booking]);
    // Customer-facing refund state for the booking detail page: 'pending' = a refund
    // is owed and being retried, 'done' = the gateway confirmed it, null = no refund
    // in play (not cancelled, forfeited deposit, or never captured).
    const payment = await this.payments.findOneBy({ bookingId: id });
    const refundStatus =
      payment?.status === 'refund_pending' ? ('pending' as const)
      : payment?.status === 'refunded' ? ('done' as const)
      : null;
    return { ...withNames, refundStatus };
  }

  async listMine(
    userId: string,
  ): Promise<Array<Booking & { salonName: string; serviceName: string; workerName: string | null }>> {
    const bookings = await this.bookings.find({ where: { userId }, order: { startsAt: 'DESC' } });
    return this.attachNames(bookings);
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
      // the one persisted. Conditioning the update on the exact status read
      // above means only the winner's write lands; the loser gets affected=0
      // and a clear 409 instead of a misleading 200. Guarding on the exact
      // status (not merely "still cancellable") also covers a concurrent
      // payment callback flipping pending_payment -> confirmed mid-cancel:
      // the payment-fate branch below relies on that same stale read, so a
      // status change must fail the CAS rather than mark a paid payment failed.
      const result = await em.update(
        Booking,
        { id: booking.id, status: booking.status },
        { status: newBookingStatus },
      );
      if (!result.affected) {
        throw new ConflictException('Booking status changed before this cancellation could be applied');
      }
      // A pending_payment booking never had a captured payment -- nothing to refund
      // or forfeit, so its payment is simply marked failed. A confirmed booking's
      // deposit was genuinely captured; `refund` decides the payment's fate.
      // refund_pending means "a real refund is owed" -- the inline attemptRefund()
      // call after this transaction commits (or, failing that, RefundRetryJob)
      // performs the actual Zarinpal refund and moves it to 'refunded'.
      if (booking.status === 'confirmed') {
        await em.update(
          Payment,
          { bookingId: booking.id },
          refund ? { status: 'refund_pending', refundRequestedAt: new Date() } : { status: 'paid' },
        );
      } else {
        // Guarded on 'initiated' as defense-in-depth: if a payment callback
        // captures the money around this cancellation, the callback's own
        // lost-CAS recovery (PaymentsService.handleCallback) queues the refund
        // for a payment we marked 'failed' -- but this guard ensures we never
        // clobber a payment that already progressed past 'initiated'.
        await em.update(Payment, { bookingId: booking.id, status: 'initiated' }, { status: 'failed' });
        // Nothing was captured, so the coupon code this hold consumed goes back to the
        // customer -- otherwise cancelling before paying would burn it for life.
        await releaseCouponRedemption(em, booking.id);
      }
    });

    // Attempt the real refund immediately so the common case completes within this
    // request (mock/happy path: customer sees the final state right away). The
    // cancellation is already committed at this point, so NOTHING from the attempt
    // may surface as an error response: attemptRefund catches gateway failures
    // internally, but a transient DB error inside it can still throw -- swallow and
    // log it here, leaving the payment refund_pending for RefundRetryJob to self-heal.
    if (refund && booking.status === 'confirmed') {
      try {
        await this.paymentsService.attemptRefund(booking.id);
      } catch (err) {
        this.logger.error(
          `Inline refund attempt failed after cancelling booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return (await this.bookings.findOneBy({ id: booking.id }))!;
  }

  private async attachNames(
    bookings: Booking[],
  ): Promise<Array<Booking & { salonName: string; serviceName: string; workerName: string | null }>> {
    if (bookings.length === 0) return [];
    const salonIds = [...new Set(bookings.map((b) => b.salonId))];
    const serviceIds = [...new Set(bookings.map((b) => b.serviceId))];
    const workerIds = [...new Set(bookings.map((b) => b.workerId).filter((id): id is string => id !== null))];
    const [salonRows, serviceRows, workerRows] = await Promise.all([
      this.salons.find({ where: { id: In(salonIds) } }),
      this.services.find({ where: { id: In(serviceIds) } }),
      workerIds.length ? this.workers.find({ where: { id: In(workerIds) } }) : Promise.resolve([]),
    ]);
    const salonNameById = new Map(salonRows.map((s) => [s.id, s.name]));
    const serviceNameById = new Map(serviceRows.map((s) => [s.id, s.name]));
    const workerNameById = new Map(workerRows.map((w) => [w.id, w.name]));
    return bookings.map((b) => ({
      ...b,
      salonName: salonNameById.get(b.salonId) ?? 'Unknown salon',
      serviceName: serviceNameById.get(b.serviceId) ?? 'Unknown service',
      workerName: b.workerId ? (workerNameById.get(b.workerId) ?? null) : null,
    }));
  }

  async listForSalon(salonId: string): Promise<Array<Booking & { salonName: string; serviceName: string; workerName: string | null }>> {
    const bookings = await this.bookings.find({ where: { salonId }, order: { startsAt: 'DESC' } });
    return this.attachNames(bookings);
  }

  async assignWorker(
    salonId: string,
    bookingId: string,
    workerId: string,
  ): Promise<Booking & { salonName: string; serviceName: string; workerName: string | null }> {
    const worker = await this.workers.findOneBy({ id: workerId, salonId });
    if (!worker) throw new NotFoundException('Worker not found');
    if (!worker.active) throw new BadRequestException('این کارمند غیرفعال است');

    const booking = await this.bookings.findOneBy({ id: bookingId, salonId });
    if (!booking) throw new NotFoundException('Booking not found');

    await this.bookings.update({ id: bookingId }, { workerId });
    const updated = (await this.bookings.findOneBy({ id: bookingId }))!;
    const [withNames] = await this.attachNames([updated]);
    return withNames;
  }

  async getEarnings(salonId: string): Promise<{
    totalCollected: number;
    commissionPercent: number;
    commissionAmount: number;
    netPayout: number;
  }> {
    const bookings = await this.bookings.find({ where: { salonId }, select: ['id'] });
    const bookingIds = bookings.map((b) => b.id);
    const paidPayments = bookingIds.length
      ? await this.payments.find({ where: { bookingId: In(bookingIds), status: 'paid' } })
      : [];

    const totalCollected = paidPayments.reduce((sum, p) => sum + p.amount, 0);
    const commissionPercent = await this.config.getCommissionPercent();
    const commissionAmount = Math.round((totalCollected * commissionPercent) / 100);

    return {
      totalCollected,
      commissionPercent,
      commissionAmount,
      netPayout: totalCollected - commissionAmount,
    };
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

    // The first-completed-booking referral trigger (R6). Only on 'completed' -- a
    // no-show is not a qualifying event. tryGrantReward already never throws and
    // internally alerts on real failures; this try/catch is an extra guard so a
    // referral-granting bug can never fail the status update response itself, matching
    // this codebase's existing policy for every other non-critical side effect wired
    // into a money/booking-adjacent flow.
    if (status === 'completed') {
      try {
        await this.referralsService.tryGrantReward(booking.userId, booking.id, 'completed');
      } catch (err) {
        this.logger.error(
          `tryGrantReward threw for booking ${booking.id} (user ${booking.userId}) after marking it completed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return (await this.bookings.findOneBy({ id: bookingId }))!;
  }
}
