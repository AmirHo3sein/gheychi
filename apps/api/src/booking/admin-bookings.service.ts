import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Salon } from '../salons/salon.entity';
import { SalonService } from '../salons/salon-service.entity';
import { Worker } from '../salons/worker.entity';
import { User } from '../users/user.entity';
import { Booking, BookingConfirmationMode, BookingStatus } from './booking.entity';
import { AdminBookingQueryDto } from './dto/admin-booking-query.dto';
import { Payment, PaymentStatus } from './payment.entity';

/** Matches AdminSalonQueryDto/AdminInvoiceQueryDto's own defaults and ceiling. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * One row of GET /admin/bookings. Deliberately carries everything a support agent needs to
 * triage a dispute WITHOUT a second request -- who booked, at which salon, for what, when,
 * what money is involved and what state that money is in. The alternative (a bare booking
 * row plus "click through for the rest") is what makes a stuck refund_pending expensive to
 * find in the first place.
 */
export interface AdminBookingRow {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  confirmationMode: BookingConfirmationMode;
  source: 'online' | 'manual';
  attributionSource: 'qr' | 'direct' | 'search' | null;
  priceSnapshot: number;
  depositAmount: number;
  createdAt: Date;
  salonId: string;
  salonName: string | null;
  serviceId: string;
  serviceName: string | null;
  workerId: string | null;
  workerName: string | null;
  userId: string;
  customerName: string | null;
  customerPhone: string | null;
  // Null when the booking has no Payment row AT ALL -- which is a real, common state, not
  // missing data: a pending_approval request never gets one (see doc 28's central
  // guarantee), and neither does a zero-deposit or offline-payment booking. Rendering this
  // as "0 تومان paid" would be a lie in every one of those cases.
  payment: {
    status: PaymentStatus;
    amount: number;
    paidAt: Date | null;
    refundRequestedAt: Date | null;
    refundedAt: Date | null;
    refundRefId: string | null;
  } | null;
  // Net commission actually accrued against this booking (accrued rows minus any
  // commission_reversed correction). Null means no financial_transactions row exists --
  // the normal case for anything that never reached completed/no_show with real captured
  // money, again NOT the same fact as "commission of zero".
  commissionAmount: number | null;
}

export interface AdminBookingListResult {
  items: AdminBookingRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * The admin-side read model over bookings.
 *
 * Deliberately its own service rather than a method on BookingsService: that class is the
 * booking STATE MACHINE (holds, locks, transitions, refunds) and is already the largest
 * file in the module, while this is a pure, side-effect-free projection with no overlap in
 * dependencies -- it injects one repository, takes no locks, and writes nothing. Keeping
 * them apart also keeps the read path independently unit-testable without standing up the
 * dozen collaborators BookingsService's constructor requires.
 */
@Injectable()
export class AdminBookingsService {
  constructor(@InjectRepository(Booking) private readonly bookings: Repository<Booking>) {}

  /**
   * One query builder, not N+1: every name (salon/service/worker/customer) and the payment
   * row come from plain LEFT JOINs, and the commission from a correlated scalar subquery.
   *
   * None of those joins can multiply the result -- salon/service/worker/customer are all
   * many-to-one, and payments.booking_id is UNIQUE -- so raw rows map 1:1 to bookings.
   * financial_transactions is the one relation that genuinely CAN have several rows per
   * booking (an accrual plus a later commission_reversed correction), which is exactly why
   * it is an aggregate subquery here instead of a sixth join: joining it would have
   * silently duplicated a corrected booking's row and inflated `total`.
   */
  async list(query: AdminBookingQueryDto): Promise<AdminBookingListResult> {
    const page = Math.max(1, query.page ?? 1);
    // Clamped here as well as by the DTO's @Max: the DTO protects the HTTP edge, this
    // protects the method itself from any future non-HTTP caller.
    const pageSize = Math.min(Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

    const qb = this.bookings
      .createQueryBuilder('booking')
      .leftJoin(Salon, 'salon', 'salon.id = booking.salonId')
      .leftJoin(SalonService, 'service', 'service.id = booking.serviceId')
      .leftJoin(Worker, 'worker', 'worker.id = booking.workerId')
      .leftJoin(User, 'customer', 'customer.id = booking.userId')
      .leftJoin(Payment, 'payment', 'payment.bookingId = booking.id')
      // A fully explicit projection read back with getRawMany(), NOT hydrated entities.
      // Entity hydration is actively wrong for this query: adding an aliased select for
      // booking.id (needed to pair each row with its joined names) makes TypeORM drop its
      // own auto-generated `booking_id` selection, which leaves every hydrated entity
      // without an id -- and since the transformer groups raw rows BY id, a whole page then
      // collapses into a single row. A flat projection has no such coupling, and every
      // column below is named exactly as it is read in toRow().
      .select('booking.id', 'id')
      .addSelect('booking.startsAt', 'startsAt')
      .addSelect('booking.endsAt', 'endsAt')
      .addSelect('booking.status', 'status')
      .addSelect('booking.confirmationMode', 'confirmationMode')
      .addSelect('booking.source', 'source')
      .addSelect('booking.attributionSource', 'attributionSource')
      .addSelect('booking.priceSnapshot', 'priceSnapshot')
      .addSelect('booking.depositAmount', 'depositAmount')
      .addSelect('booking.createdAt', 'createdAt')
      .addSelect('booking.salonId', 'salonId')
      .addSelect('booking.serviceId', 'serviceId')
      .addSelect('booking.workerId', 'workerId')
      .addSelect('booking.userId', 'userId')
      .addSelect('salon.name', 'salonName')
      .addSelect('service.name', 'serviceName')
      .addSelect('worker.name', 'workerName')
      .addSelect('customer.name', 'customerName')
      .addSelect('customer.phone', 'customerPhone')
      .addSelect('payment.status', 'paymentStatus')
      .addSelect('payment.amount', 'paymentAmount')
      .addSelect('payment.paidAt', 'paymentPaidAt')
      .addSelect('payment.refundRequestedAt', 'paymentRefundRequestedAt')
      .addSelect('payment.refundedAt', 'paymentRefundedAt')
      .addSelect('payment.refundRefId', 'paymentRefundRefId')
      // Signed sum so a commission_reversed correction row nets out, rather than being
      // added to the accrual it was written to undo. No COALESCE on purpose: SQL NULL here
      // means "no ledger row at all", which toRow() maps to a null commissionAmount and the
      // UI renders as "—" instead of a misleading zero.
      .addSelect(
        `(SELECT SUM(CASE WHEN ft.type = 'commission_reversed' THEN -ft.commission_amount ELSE ft.commission_amount END)
            FROM financial_transactions ft WHERE ft.booking_id = booking.id)`,
        'commissionAmount',
      )
      // Most-recent appointment first -- the support-triage default. booking.id is a
      // deterministic tiebreaker so two bookings sharing a startsAt can't swap places
      // between page 1 and page 2 and hide a row.
      .orderBy('booking.startsAt', 'DESC')
      .addOrderBy('booking.id', 'DESC');

    if (query.status) qb.andWhere('booking.status = :status', { status: query.status });
    if (query.salonId) qb.andWhere('booking.salonId = :salonId', { salonId: query.salonId });
    if (query.userId) qb.andWhere('booking.userId = :userId', { userId: query.userId });
    if (query.confirmationMode) {
      qb.andWhere('booking.confirmationMode = :confirmationMode', { confirmationMode: query.confirmationMode });
    }
    if (query.source) qb.andWhere('booking.source = :source', { source: query.source });
    // Filters through the already-present join, so it costs nothing extra; a booking with
    // no Payment row simply never matches (see the DTO's own note).
    if (query.paymentStatus) qb.andWhere('payment.status = :paymentStatus', { paymentStatus: query.paymentStatus });
    if (query.from) qb.andWhere('booking.startsAt >= :from', { from: query.from });
    if (query.to) qb.andWhere('booking.startsAt <= :to', { to: query.to });

    // getCount() BEFORE offset/limit are applied -- it rewrites the select list but not the
    // pagination clauses, so ordering these two calls the other way would count one page.
    const total = await qb.getCount();

    // offset/limit rather than skip/take: skip/take is entity-pagination machinery
    // (DISTINCT-id subqueries) that a flat raw projection neither needs nor uses.
    const raw: Record<string, unknown>[] = await qb
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getRawMany();

    return { items: raw.map((row) => this.toRow(row)), total, page, pageSize };
  }

  private toRow(raw: Record<string, unknown>): AdminBookingRow {
    const paymentStatus = raw.paymentStatus as PaymentStatus | null | undefined;
    return {
      id: String(raw.id),
      startsAt: dateOrNull(raw.startsAt) as Date,
      endsAt: dateOrNull(raw.endsAt) as Date,
      status: raw.status as BookingStatus,
      confirmationMode: raw.confirmationMode as BookingConfirmationMode,
      source: raw.source as 'online' | 'manual',
      attributionSource: (raw.attributionSource as AdminBookingRow['attributionSource']) ?? null,
      // Raw-selected bigints bypass the entity's bigintToNumber transformer (it only runs
      // for hydrated entity properties), so pg hands every one of these back as a string.
      priceSnapshot: numberOrZero(raw.priceSnapshot),
      depositAmount: numberOrZero(raw.depositAmount),
      createdAt: dateOrNull(raw.createdAt) as Date,
      salonId: String(raw.salonId),
      salonName: (raw.salonName as string | null) ?? null,
      serviceId: String(raw.serviceId),
      serviceName: (raw.serviceName as string | null) ?? null,
      workerId: (raw.workerId as string | null) ?? null,
      workerName: (raw.workerName as string | null) ?? null,
      userId: String(raw.userId),
      customerName: (raw.customerName as string | null) ?? null,
      customerPhone: (raw.customerPhone as string | null) ?? null,
      payment: paymentStatus
        ? {
            status: paymentStatus,
            amount: numberOrZero(raw.paymentAmount),
            paidAt: dateOrNull(raw.paymentPaidAt),
            refundRequestedAt: dateOrNull(raw.paymentRefundRequestedAt),
            refundedAt: dateOrNull(raw.paymentRefundedAt),
            refundRefId: (raw.paymentRefundRefId as string | null) ?? null,
          }
        : null,
      commissionAmount: raw.commissionAmount === null || raw.commissionAmount === undefined
        ? null
        : Number(raw.commissionAmount),
    };
  }
}

function numberOrZero(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}
