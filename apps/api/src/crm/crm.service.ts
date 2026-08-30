import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CustomerNote } from './customer-note.entity';

export type CustomerSegment = 'new' | 'returning' | 'lapsed';

// A returning customer with no visit in this many days reads as lapsed instead. A fixed
// MVP heuristic, not admin/owner-configurable -- same "hardcoded TTL, no per-salon knob"
// cut this codebase already made for story/portfolio caps.
const LAPSED_AFTER_DAYS = 60;
// Defensive ceiling, not a UX pagination feature -- same posture as bookings.service.ts's
// own MAX_SALON_BOOKINGS_LISTED (no pagination UI consumes this list yet either).
const MAX_CUSTOMERS_LISTED = 2000;

export interface CustomerListRow {
  userId: string;
  name: string | null;
  phone: string;
  bookingsCount: number;
  completedCount: number;
  lastVisitAt: string | null;
  grossValue: number;
  segment: CustomerSegment;
}

export interface CustomerBookingRow {
  id: string;
  startsAt: string;
  status: string;
  priceSnapshot: number;
  serviceName: string | null;
}

export interface DashboardSummary {
  from: string;
  to: string;
  bookingsCount: number;
  grossBookingValue: number;
  onlineCollected: number;
  commission: number;
  estimatedSalonRevenue: number;
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
  ) {}

  private resolveSegment(bookingsCount: number, lastVisitAt: string | null): CustomerSegment {
    if (bookingsCount <= 1) return 'new';
    if (!lastVisitAt) return 'returning';
    const daysSinceVisit = (Date.now() - new Date(lastVisitAt).getTime()) / 86_400_000;
    return daysSinceVisit > LAPSED_AFTER_DAYS ? 'lapsed' : 'returning';
  }

  async listCustomers(salonId: string): Promise<CustomerListRow[]> {
    const rows: Array<{
      user_id: string;
      name: string | null;
      phone: string;
      bookings_count: string;
      completed_count: string;
      last_visit_at: string | null;
      gross_value: string;
    }> = await this.dataSource.query(
      `
      SELECT
        u.id AS user_id,
        u.name,
        u.phone,
        COUNT(b.id) AS bookings_count,
        COUNT(b.id) FILTER (WHERE b.status = 'completed') AS completed_count,
        MAX(b.starts_at) AS last_visit_at,
        COALESCE(SUM(b.price_snapshot) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0) AS gross_value
      FROM bookings b
      JOIN users u ON u.id = b.user_id
      WHERE b.salon_id = $1
      GROUP BY u.id, u.name, u.phone
      ORDER BY MAX(b.starts_at) DESC
      LIMIT ${MAX_CUSTOMERS_LISTED}
      `,
      [salonId],
    );

    return rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      phone: r.phone,
      bookingsCount: Number(r.bookings_count),
      completedCount: Number(r.completed_count),
      lastVisitAt: r.last_visit_at,
      grossValue: Number(r.gross_value),
      segment: this.resolveSegment(Number(r.bookings_count), r.last_visit_at),
    }));
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
   * Every figure here is either directly observed or an explicit, documented derivation of
   * observed numbers -- never invented. grossBookingValue is the full agreed service price
   * (bookings.price_snapshot), NOT financial_transactions.gross_amount (which is actually
   * the online DEPOSIT only -- see that column's own doc comment). estimatedSalonRevenue is
   * labeled "estimated" specifically because it assumes the salon's own cash portion was
   * genuinely collected in full, which this platform cannot observe or verify.
   *
   * All three queries below filter by when the ACTIVITY HAPPENED (bookings.created_at,
   * payments.paid_at, financial_transactions.created_at) -- deliberately NOT bookings'
   * own starts_at, which is almost always in the future relative to when the booking was
   * made and would make "business generated in the last 30 days" silently exclude bookings
   * for appointments further out than that, while including old bookings for appointments
   * happening soon. One consistent "when did this happen" lens across all three figures.
   */
  async getDashboardSummary(salonId: string, from: Date, to: Date): Promise<DashboardSummary> {
    const [bookingRow]: Array<{ gross: string; bookings_count: string }> = await this.dataSource.query(
      `
      SELECT COALESCE(SUM(price_snapshot), 0) AS gross, COUNT(*) AS bookings_count
      FROM bookings
      WHERE salon_id = $1 AND status IN ('confirmed', 'completed') AND created_at >= $2 AND created_at < $3
      `,
      [salonId, from, to],
    );
    const [collectedRow]: Array<{ collected: string }> = await this.dataSource.query(
      `
      SELECT COALESCE(SUM(p.amount), 0) AS collected
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      WHERE b.salon_id = $1 AND p.status = 'paid' AND p.paid_at >= $2 AND p.paid_at < $3
      `,
      [salonId, from, to],
    );
    const [commissionRow]: Array<{ commission: string }> = await this.dataSource.query(
      `
      SELECT COALESCE(SUM(commission_amount), 0) AS commission
      FROM financial_transactions
      WHERE salon_id = $1 AND created_at >= $2 AND created_at < $3
      `,
      [salonId, from, to],
    );

    const grossBookingValue = Number(bookingRow!.gross);
    const commission = Number(commissionRow!.commission);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      bookingsCount: Number(bookingRow!.bookings_count),
      grossBookingValue,
      onlineCollected: Number(collectedRow!.collected),
      commission,
      estimatedSalonRevenue: grossBookingValue - commission,
    };
  }
}
