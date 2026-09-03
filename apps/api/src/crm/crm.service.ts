import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { likeContains } from '../common/like-pattern';
import { EntitlementsService } from '../subscriptions/entitlements.service';
import { CustomerNote } from './customer-note.entity';
import { CUSTOMER_SORTS, CustomerSort } from './dto/customer-list-query.dto';

export type CustomerSegment = 'new' | 'returning' | 'lapsed';

// A returning customer with no visit in this many days reads as lapsed instead. A fixed
// MVP heuristic, not admin/owner-configurable -- same "hardcoded TTL, no per-salon knob"
// cut this codebase already made for story/portfolio caps.
const LAPSED_AFTER_DAYS = 60;

/**
 * What counts as a VISIT, as opposed to merely a booking row.
 *
 * This predicate is the fix for a real correctness bug: `lastVisitAt` used to be a bare
 * `MAX(starts_at)` over EVERY status, so a customer with a booking next Tuesday had a "last
 * visit" in the future, and a customer whose only bookings were cancelled looked like they
 * had been in. Both fed straight into the lapsed/returning segmentation.
 *
 * Semantics chosen, and deliberately the looser of the two candidates: an appointment whose
 * start time is already past AND which was never cancelled, rejected, or expired --
 * `completed` (the salon actually confirmed it happened) plus `confirmed`-and-past. Strictly
 * `completed`-only would be more literally true, but marking a booking completed is a manual
 * provider action many salons never perform, and for those salons every single customer
 * would read as never-visited and eventually `lapsed`. Counting a past confirmed booking as
 * a visit occasionally over-counts a no-show the salon never recorded; the alternative
 * mis-segments an entire customer base. `no_show` is excluded: that IS a recorded
 * non-visit.
 *
 * Written once and referenced by every aggregate below so the definition cannot drift
 * between "first visit", "last visit", and "visit count" -- the same reason
 * `SLOT_BLOCKING_STATUSES` exists in booking.entity.ts.
 */
const VISITED_BOOKING_SQL = `b.starts_at < now() AND b.status IN ('confirmed', 'completed')`;

// Bookings that represent real, non-cancelled business. Used for the money figures and the
// booking/customer counts alike so "10 bookings worth 5,000,000" is always self-consistent.
const ACTIVE_BOOKING_STATUSES_SQL = `('confirmed', 'completed')`;

// Top-N lists on the dashboard. A fixed small ceiling, not a paginated view -- these answer
// "what should I look at", not "show me everything".
const TOP_N = 5;

export interface CustomerListRow {
  userId: string;
  name: string | null;
  phone: string;
  /** EVERY booking this customer has ever made at this salon, in any status -- including
   *  future appointments and cancellations. Deliberately kept as a raw activity count
   *  (the UI labels it as such); `visitsCount` is the "actually turned up" figure. */
  bookingsCount: number;
  /** Bookings the salon explicitly marked `completed`. */
  completedCount: number;
  /** Bookings matching VISITED_BOOKING_SQL -- past and not cancelled. */
  visitsCount: number;
  firstVisitAt: string | null;
  lastVisitAt: string | null;
  grossValue: number;
  segment: CustomerSegment;
}

export interface CustomerListPage {
  items: CustomerListRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CustomerListFilters {
  q?: string;
  segment?: CustomerSegment;
  sort?: CustomerSort;
  page?: number;
  pageSize?: number;
}

export interface CustomerBookingRow {
  id: string;
  startsAt: string;
  status: string;
  priceSnapshot: number;
  serviceName: string | null;
}

/**
 * Everything the dashboard reports for ONE date window. Computed identically for the
 * requested period and the immediately-preceding one of the same length, so every figure
 * has an honest month-over-month comparison rather than a number floating in isolation.
 */
export interface PeriodMetrics {
  from: string;
  to: string;
  /** Bookings CREATED in the window whose status is confirmed/completed. */
  bookingsCount: number;
  grossBookingValue: number;
  onlineCollected: number;
  commission: number;
  estimatedSalonRevenue: number;
  /** Distinct customers behind `bookingsCount`. */
  distinctCustomers: number;
  /** Of those, the ones whose FIRST-ever booking at this salon falls inside the window. */
  newCustomers: number;
  /** `distinctCustomers - newCustomers` -- customers who had booked here before. */
  returningCustomers: number;
  completedCount: number;
  /** cancelled_by_user + cancelled_by_salon only. `rejected_by_salon` and `expired` are
   *  deliberately NOT folded in here: neither is a cancelled appointment (one was declined
   *  before it ever existed, the other never got paid for), and conflating them would
   *  inflate a salon's apparent cancellation problem. */
  cancelledCount: number;
  noShowCount: number;
  /** grossBookingValue / bookingsCount, 0 when there were no bookings. */
  averageBookingValue: number;
  /** returningCustomers / distinctCustomers as a percentage, 0 when nobody booked. */
  repeatRatePercent: number;
}

export interface TopServiceRow {
  serviceId: string;
  name: string | null;
  bookingsCount: number;
  grossValue: number;
}

export interface TopWorkerRow {
  workerId: string;
  name: string | null;
  bookingsCount: number;
}

export interface DashboardSummary extends PeriodMetrics {
  previous: PeriodMetrics;
  topServices: TopServiceRow[];
  topWorkers: TopWorkerRow[];
  /** Tehran-local day of week, 0 = Sunday. `null` when the window has no appointments. */
  busiestWeekday: number | null;
  /** Tehran-local hour, 0-23. `null` when the window has no appointments. */
  busiestHour: number | null;
}

/** pg hands back `timestamptz` as a JS `Date`; the API contract is an ISO string. */
function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * The salon-scoped CRM read model -- entirely derived from existing bookings/payments/
 * financial_transactions rows, no separate Customer entity (see
 * docs/technical-overview/32-salon-crm.md for the full rationale, including the financial-
 * terminology precision this module is deliberately careful about).
 */
@Injectable()
export class CrmService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(CustomerNote) private readonly notes: Repository<CustomerNote>,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Searchable, filterable, sortable, PAGINATED customer list.
   *
   * The segment is derived in SQL rather than in TypeScript (as it was originally) because
   * it is now a filterable column: deriving it after the fact would mean filtering a page
   * that was already cut, which silently returns fewer rows than `pageSize` and a `total`
   * that doesn't match. One derivation, inside the query, is the only shape where
   * filter + count + page agree.
   *
   * `COUNT(*) OVER()` gets the filtered total in the same round trip as the page. The old
   * `MAX_CUSTOMERS_LISTED = 2000` defensive ceiling is gone with it -- `pageSize` is capped
   * at 100 by the DTO, so the result set is bounded by construction now rather than by a
   * ceiling nothing surfaced.
   */
  async listCustomers(salonId: string, filters: CustomerListFilters = {}): Promise<CustomerListPage> {
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    // Whitelisted lookup, never interpolated caller input -- see CUSTOMER_SORTS' own note.
    // The user_id tiebreaker makes paging deterministic: without it, two customers with the
    // same last-visit date can swap places between page 1 and page 2 and one of them is
    // never shown.
    const orderBy = `${CUSTOMER_SORTS[filters.sort ?? 'recent']}, user_id ASC`;
    const search = filters.q ? likeContains(filters.q) : null;
    // Ceiling on the CRM customer list (entitlements.crmCustomerCap). `null` means
    // unlimited -- the registry default, and also exactly what Postgres' own `LIMIT NULL`
    // means (documented as identical to `LIMIT ALL`, i.e. no limit at all), so the same
    // parameter/placeholder carries both the capped and uncapped case with no branching SQL.
    const cap = await this.entitlements.getLimit(salonId, 'crmCustomerCap');

    const rows: Array<{
      user_id: string;
      name: string | null;
      phone: string;
      bookings_count: string;
      completed_count: string;
      visits_count: string;
      first_visit_at: Date | null;
      last_visit_at: Date | null;
      gross_value: string;
      segment: CustomerSegment;
      total_count: string;
    }> = await this.dataSource.query(
      `
      WITH per_customer AS (
        SELECT
          u.id AS user_id,
          u.name,
          u.phone,
          COUNT(b.id) AS bookings_count,
          COUNT(b.id) FILTER (WHERE b.status = 'completed') AS completed_count,
          COUNT(b.id) FILTER (WHERE ${VISITED_BOOKING_SQL}) AS visits_count,
          MIN(b.starts_at) FILTER (WHERE ${VISITED_BOOKING_SQL}) AS first_visit_at,
          MAX(b.starts_at) FILTER (WHERE ${VISITED_BOOKING_SQL}) AS last_visit_at,
          COALESCE(SUM(b.price_snapshot) FILTER (WHERE b.status IN ${ACTIVE_BOOKING_STATUSES_SQL}), 0) AS gross_value
        FROM bookings b
        JOIN users u ON u.id = b.user_id
        WHERE b.salon_id = $1
        GROUP BY u.id, u.name, u.phone
      ), segmented AS (
        SELECT
          per_customer.*,
          CASE
            WHEN bookings_count <= 1 THEN 'new'
            -- More than one booking but never actually in the chair yet (all of them still
            -- upcoming, or all cancelled). Kept as 'returning' rather than inventing a
            -- fourth segment: the three-way split is a documented product decision.
            WHEN last_visit_at IS NULL THEN 'returning'
            WHEN last_visit_at < now() - interval '${LAPSED_AFTER_DAYS} days' THEN 'lapsed'
            ELSE 'returning'
          END AS segment
        FROM per_customer
      -- 'capped' is the entitlement ceiling applied to the salon's WHOLE customer universe,
      -- before any of this request's own search/segment/sort/page -- an admin-set cap bounds
      -- what the CRM can ever surface, not just what one particular filtered view returns.
      -- Ordered by the same "most recently seen" default the list itself defaults to, so an
      -- unlimited-vs-capped salon differ only in how many of the same, deterministically
      -- ranked rows are visible -- never in WHICH ones. LIMIT $6 with $6 = NULL is Postgres'
      -- own documented equivalent of LIMIT ALL (no limit), so this needs no branching SQL for
      -- the (default, far more common) unlimited case.
      ), capped AS (
        SELECT * FROM segmented
        ORDER BY last_visit_at DESC NULLS LAST, user_id ASC
        LIMIT $6::bigint
      )
      SELECT *, COUNT(*) OVER() AS total_count
      FROM capped
      -- ESCAPE '\\' in this TS template literal emits a single backslash into the SQL. The
      -- pattern itself is wildcard-escaped by likeContains() so a customer searching for
      -- "%" gets no rows rather than every row.
      WHERE ($2::text IS NULL OR name ILIKE $2 ESCAPE '\\' OR phone ILIKE $2 ESCAPE '\\')
        AND ($3::text IS NULL OR segment = $3)
      ORDER BY ${orderBy}
      LIMIT $4 OFFSET $5
      `,
      [salonId, search, filters.segment ?? null, pageSize, (page - 1) * pageSize, cap],
    );

    return {
      items: rows.map((r) => ({
        userId: r.user_id,
        name: r.name,
        phone: r.phone,
        bookingsCount: Number(r.bookings_count),
        completedCount: Number(r.completed_count),
        visitsCount: Number(r.visits_count),
        firstVisitAt: toIso(r.first_visit_at),
        lastVisitAt: toIso(r.last_visit_at),
        grossValue: Number(r.gross_value),
        segment: r.segment,
      })),
      // No rows at all means no matches, which means a total of 0 -- the window function
      // can only report a count when there is at least one row to hang it off.
      total: rows.length > 0 ? Number(rows[0]!.total_count) : 0,
      page,
      pageSize,
    };
  }

  async getCustomerDetail(
    salonId: string,
    customerId: string,
  ): Promise<{ customer: { id: string; name: string | null; phone: string }; bookings: CustomerBookingRow[]; notes: CustomerNote[] }> {
    // Ownership isolation: a "customer" only exists in this salon's CRM if they actually
    // have at least one booking here -- this single query is both the data fetch AND the
    // access check, so there is no separate "does this user belong to me" branch to forget.
    const bookingRows: Array<{ id: string; starts_at: string; status: string; price_snapshot: string; service_name: string | null }> =
      await this.dataSource.query(
        `
        SELECT b.id, b.starts_at, b.status, b.price_snapshot, s.name AS service_name
        FROM bookings b
        LEFT JOIN salon_services s ON s.id = b.service_id
        WHERE b.salon_id = $1 AND b.user_id = $2
        ORDER BY b.starts_at DESC
        `,
        [salonId, customerId],
      );
    if (bookingRows.length === 0) throw new NotFoundException('No customer found for this salon');

    const [userRow]: Array<{ id: string; name: string | null; phone: string }> = await this.dataSource.query(
      `SELECT id, name, phone FROM users WHERE id = $1`,
      [customerId],
    );

    const notes = await this.notes.find({ where: { salonId, customerId }, order: { createdAt: 'DESC' } });

    return {
      customer: { id: userRow!.id, name: userRow!.name, phone: userRow!.phone },
      bookings: bookingRows.map((b) => ({
        id: b.id,
        startsAt: b.starts_at,
        status: b.status,
        priceSnapshot: Number(b.price_snapshot),
        serviceName: b.service_name,
      })),
      notes,
    };
  }

  /** Throws the same NotFoundException getCustomerDetail would, without re-running its
   *  bigger query -- addNote() (and customer-sms.service.ts's send()) need the same
   *  ownership check but not the booking history. Public: it's the one shared "is this
   *  really this salon's customer" seam, not private to this service alone. */
  async requireCustomerBelongsToSalon(salonId: string, customerId: string): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM bookings WHERE salon_id = $1 AND user_id = $2 LIMIT 1`,
      [salonId, customerId],
    );
    if (!row) throw new NotFoundException('No customer found for this salon');
  }

  /** Ownership-checked customer identity only -- no booking history/notes, for callers
   *  (customer-sms.service.ts) that just need a name/phone to act on. */
  async getCustomerContact(salonId: string, customerId: string): Promise<{ id: string; name: string | null; phone: string }> {
    await this.requireCustomerBelongsToSalon(salonId, customerId);
    const [userRow]: Array<{ id: string; name: string | null; phone: string }> = await this.dataSource.query(
      `SELECT id, name, phone FROM users WHERE id = $1`,
      [customerId],
    );
    return { id: userRow!.id, name: userRow!.name, phone: userRow!.phone };
  }

  async addNote(salonId: string, customerId: string, actorId: string, note: string): Promise<CustomerNote> {
    await this.requireCustomerBelongsToSalon(salonId, customerId);
    return this.notes.save(this.notes.create({ salonId, customerId, note, createdBy: actorId }));
  }

  async deleteNote(salonId: string, customerId: string, noteId: string): Promise<void> {
    const result = await this.notes.delete({ id: noteId, salonId, customerId });
    if (!result.affected) throw new NotFoundException('Note not found');
  }

  /**
   * The provider dashboard's whole data set: the money figures, the operational counts, a
   * previous-period comparison, and the three "what should I look at" breakdowns.
   *
   * Every figure here is either directly observed or an explicit, documented derivation of
   * observed numbers -- never invented. grossBookingValue is the full agreed service price
   * (bookings.price_snapshot), NOT financial_transactions.gross_amount (which is actually
   * the online DEPOSIT only -- see that column's own doc comment). estimatedSalonRevenue is
   * labeled "estimated" specifically because it assumes the salon's own cash portion was
   * genuinely collected in full, which this platform cannot observe or verify.
   *
   * The previous period is the same-length window ending exactly where this one starts, so
   * "last 30 days" compares against the 30 days before that. Computed by the identical code
   * path (`periodMetrics`), never a second, subtly-different query.
   *
   * Every query is salon-scoped by its own WHERE clause -- the query shape is the access
   * check, the same pattern getCustomerDetail() uses -- and bounded (LIMIT on the top-N
   * lists, a single aggregate row otherwise).
   */
  async getDashboardSummary(salonId: string, from: Date, to: Date): Promise<DashboardSummary> {
    const previousTo = from;
    const previousFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));

    const [current, previous, topServices, topWorkers, busiestWeekday, busiestHour] = await Promise.all([
      this.periodMetrics(salonId, from, to),
      this.periodMetrics(salonId, previousFrom, previousTo),
      this.topServices(salonId, from, to),
      this.topWorkers(salonId, from, to),
      this.busiestBy(salonId, from, to, 'DOW'),
      this.busiestBy(salonId, from, to, 'HOUR'),
    ]);

    return { ...current, previous, topServices, topWorkers, busiestWeekday, busiestHour };
  }

  /**
   * All four "when did this happen" queries for one window.
   *
   * Date-window semantics: these filter by when the ACTIVITY HAPPENED
   * (bookings.created_at, payments.paid_at, financial_transactions.created_at) --
   * deliberately NOT bookings' own starts_at, which is almost always in the future relative
   * to when the booking was made and would make "business generated in the last 30 days"
   * silently exclude bookings for appointments further out than that, while including old
   * bookings for appointments happening soon. One consistent lens across every money and
   * count figure. (The two `busiestBy` queries below are the deliberate exception, for a
   * reason spelled out there.)
   */
  private async periodMetrics(salonId: string, from: Date, to: Date): Promise<PeriodMetrics> {
    const [[bookingRow], [collectedRow], [commissionRow], [newCustomerRow]]: [
      Array<{
        gross: string;
        bookings_count: string;
        completed_count: string;
        cancelled_count: string;
        no_show_count: string;
        distinct_customers: string;
      }>,
      Array<{ collected: string }>,
      Array<{ commission: string }>,
      Array<{ new_customers: string }>,
    ] = await Promise.all([
      // One pass over the salon's bookings with FILTER aggregates, rather than one query per
      // counter -- same window, same rows, so splitting it up would only multiply round
      // trips and risk the figures disagreeing if the filters ever drifted apart.
      this.dataSource.query(
        `
        SELECT
          COALESCE(SUM(price_snapshot) FILTER (WHERE status IN ${ACTIVE_BOOKING_STATUSES_SQL}), 0) AS gross,
          COUNT(*) FILTER (WHERE status IN ${ACTIVE_BOOKING_STATUSES_SQL}) AS bookings_count,
          COUNT(DISTINCT user_id) FILTER (WHERE status IN ${ACTIVE_BOOKING_STATUSES_SQL}) AS distinct_customers,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
          COUNT(*) FILTER (WHERE status IN ('cancelled_by_user', 'cancelled_by_salon')) AS cancelled_count,
          COUNT(*) FILTER (WHERE status = 'no_show') AS no_show_count
        FROM bookings
        WHERE salon_id = $1 AND created_at >= $2 AND created_at < $3
        `,
        [salonId, from, to],
      ),
      this.dataSource.query(
        `
        SELECT COALESCE(SUM(p.amount), 0) AS collected
        FROM payments p
        JOIN bookings b ON b.id = p.booking_id
        WHERE b.salon_id = $1 AND p.status = 'paid' AND p.paid_at >= $2 AND p.paid_at < $3
        `,
        [salonId, from, to],
      ),
      this.dataSource.query(
        `
        SELECT COALESCE(SUM(commission_amount), 0) AS commission
        FROM financial_transactions
        WHERE salon_id = $1 AND created_at >= $2 AND created_at < $3
        `,
        [salonId, from, to],
      ),
      // "New" = this salon has never seen them before the window, judged over ALL of the
      // salon's history, not just the window. The inner status filter matches
      // distinct_customers' own filter exactly, which is what guarantees
      // newCustomers <= distinctCustomers and keeps `returning` from ever going negative.
      this.dataSource.query(
        `
        SELECT COUNT(*) AS new_customers
        FROM (
          SELECT user_id, MIN(created_at) AS first_booked_at
          FROM bookings
          WHERE salon_id = $1 AND status IN ${ACTIVE_BOOKING_STATUSES_SQL}
          GROUP BY user_id
        ) first_booking
        WHERE first_booked_at >= $2 AND first_booked_at < $3
        `,
        [salonId, from, to],
      ),
    ]);

    const grossBookingValue = Number(bookingRow!.gross);
    const commission = Number(commissionRow!.commission);
    const bookingsCount = Number(bookingRow!.bookings_count);
    const distinctCustomers = Number(bookingRow!.distinct_customers);
    const newCustomers = Number(newCustomerRow!.new_customers);
    const returningCustomers = distinctCustomers - newCustomers;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      bookingsCount,
      grossBookingValue,
      onlineCollected: Number(collectedRow!.collected),
      commission,
      estimatedSalonRevenue: grossBookingValue - commission,
      distinctCustomers,
      newCustomers,
      returningCustomers,
      completedCount: Number(bookingRow!.completed_count),
      cancelledCount: Number(bookingRow!.cancelled_count),
      noShowCount: Number(bookingRow!.no_show_count),
      // Rounded to whole toman/percent: these are dashboard headline figures, and a
      // fractional toman would only ever read as noise.
      averageBookingValue: bookingsCount === 0 ? 0 : Math.round(grossBookingValue / bookingsCount),
      repeatRatePercent: distinctCustomers === 0 ? 0 : Math.round((returningCustomers / distinctCustomers) * 100),
    };
  }

  private async topServices(salonId: string, from: Date, to: Date): Promise<TopServiceRow[]> {
    const rows: Array<{ service_id: string; name: string | null; bookings_count: string; gross_value: string }> =
      await this.dataSource.query(
        `
        SELECT b.service_id, s.name, COUNT(*) AS bookings_count, COALESCE(SUM(b.price_snapshot), 0) AS gross_value
        FROM bookings b
        LEFT JOIN salon_services s ON s.id = b.service_id
        WHERE b.salon_id = $1 AND b.status IN ${ACTIVE_BOOKING_STATUSES_SQL} AND b.created_at >= $2 AND b.created_at < $3
        GROUP BY b.service_id, s.name
        ORDER BY COUNT(*) DESC, gross_value DESC
        LIMIT ${TOP_N}
        `,
        [salonId, from, to],
      );
    return rows.map((r) => ({
      serviceId: r.service_id,
      name: r.name,
      bookingsCount: Number(r.bookings_count),
      grossValue: Number(r.gross_value),
    }));
  }

  private async topWorkers(salonId: string, from: Date, to: Date): Promise<TopWorkerRow[]> {
    // worker_id is nullable (a salon can run without named staff, and a booking made before
    // the salon added workers has none) -- those rows are excluded rather than bucketed
    // under a fake "unassigned" worker, which would top the list at most salons and say
    // nothing.
    const rows: Array<{ worker_id: string; name: string | null; bookings_count: string }> = await this.dataSource.query(
      `
      SELECT b.worker_id, w.name, COUNT(*) AS bookings_count
      FROM bookings b
      LEFT JOIN workers w ON w.id = b.worker_id
      WHERE b.salon_id = $1 AND b.worker_id IS NOT NULL
        AND b.status IN ${ACTIVE_BOOKING_STATUSES_SQL} AND b.created_at >= $2 AND b.created_at < $3
      GROUP BY b.worker_id, w.name
      ORDER BY COUNT(*) DESC, w.name ASC
      LIMIT ${TOP_N}
      `,
      [salonId, from, to],
    );
    return rows.map((r) => ({ workerId: r.worker_id, name: r.name, bookingsCount: Number(r.bookings_count) }));
  }

  /**
   * Busiest Tehran-local weekday (0 = Sunday) or hour (0-23) in the window.
   *
   * Two things here are deliberate and easy to get wrong:
   *
   * 1. `AT TIME ZONE 'Asia/Tehran'` is mandatory. `starts_at` is `timestamptz`, and a bare
   *    `EXTRACT(HOUR FROM starts_at)` reads it in UTC -- which is 3.5 hours behind Iran, so
   *    a salon whose busiest hour is 10:00 would be told 06:00, and worse, the half-hour
   *    offset means the reported hour is wrong for the bottom half of every hour. This is
   *    the DB-side counterpart of common/iran-time.util.ts, which the JS side uses for the
   *    same reason; the two agree because Iran abolished DST in 2022 and is a fixed +3:30.
   *
   * 2. This is the ONE place that windows on `starts_at` instead of `created_at`. The
   *    question "when is my salon busy?" is about when customers are physically in the
   *    chair; windowing it by `created_at` would answer "when do people book", a different
   *    (also interesting, but not asked-for) question.
   *
   * `field` is a hardcoded literal from this method's own union type, never caller input.
   */
  private async busiestBy(salonId: string, from: Date, to: Date, field: 'DOW' | 'HOUR'): Promise<number | null> {
    const [row]: Array<{ bucket: number }> = await this.dataSource.query(
      `
      SELECT EXTRACT(${field} FROM b.starts_at AT TIME ZONE 'Asia/Tehran')::int AS bucket
      FROM bookings b
      WHERE b.salon_id = $1 AND b.status IN ${ACTIVE_BOOKING_STATUSES_SQL} AND b.starts_at >= $2 AND b.starts_at < $3
      GROUP BY bucket
      -- The bucket tiebreaker keeps this deterministic: with two equally-busy days, a bare
      -- COUNT DESC could return either one on different runs and the dashboard would appear
      -- to flip at random.
      ORDER BY COUNT(*) DESC, bucket ASC
      LIMIT 1
      `,
      [salonId, from, to],
    );
    return row ? Number(row.bucket) : null;
  }
}
