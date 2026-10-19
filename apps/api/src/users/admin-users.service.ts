import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Salon, SuspendedCause } from '../salons/salon.entity';
import { User, UserStatus } from './user.entity';

const OWNER_SUSPENDED: SuspendedCause = 'owner_suspended';
const RECENT_BOOKINGS = 10;
const RECENT_ACTIVITY = 10;

export interface AdminUserDetail {
  user: Pick<User, 'id' | 'phone' | 'name' | 'gender' | 'role' | 'status' | 'createdAt'>;
  /** The salon this account owns (one per owner), any status. */
  salon: { id: string; name: string; slug: string; status: string } | null;
  /** Salons where this account is listed as staff. */
  workerAt: Array<{ salonId: string; salonName: string; active: boolean }>;
  /** This account's own bookings as a customer. */
  bookings: {
    total: number;
    byStatus: Record<string, number>;
    recent: Array<{ id: string; startsAt: Date; status: string; salonId: string; salonName: string; serviceName: string; priceSnapshot: number }>;
  };
  wallet: { toman: number; points: number };
  reviewsCount: number;
  /** Admin actions on this account: status changes and wallet adjustments, newest first. */
  activity: Array<{
    id: string;
    action: string;
    success: boolean;
    createdAt: Date;
    actor: { id: string; name: string | null; phone: string | null };
    status: string | null;
    amount: number | null;
    /** wallet.adjust only: 'toman' or 'points' (the adjust endpoint defaults to toman). */
    currency: string | null;
    reason: string | null;
  }>;
}

@Injectable()
export class AdminUsersService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Everything an admin needs to support one account, read-only, in one round trip: the
   * profile, the salon it owns or works at, its own bookings, wallet balances, review count
   * and the admin actions taken on it. Every figure is counted in SQL from the source tables;
   * nothing here is cached or derived client-side.
   */
  async getDetail(id: string): Promise<AdminUserDetail> {
    const user = await this.dataSource.getRepository(User).findOne({
      where: { id },
      select: ['id', 'phone', 'name', 'gender', 'role', 'status', 'createdAt'],
    });
    if (!user) throw new NotFoundException();

    const q = <T>(sql: string, params: unknown[] = [id]) => this.dataSource.query(sql, params) as Promise<T[]>;
    const [salons, workerAt, statusRows, recent, balances, reviews, activity] = await Promise.all([
      q<{ id: string; name: string; slug: string; status: string }>(
        `SELECT id, name, slug, status FROM salons WHERE owner_id = $1 LIMIT 1`,
      ),
      q<{ salonId: string; salonName: string; active: boolean }>(
        `SELECT w.salon_id AS "salonId", s.name AS "salonName", w.active
           FROM workers w JOIN salons s ON s.id = w.salon_id
          WHERE w.user_id = $1 ORDER BY w.active DESC, s.name`,
      ),
      q<{ status: string; n: string }>(`SELECT status, COUNT(*) AS n FROM bookings WHERE user_id = $1 GROUP BY status`),
      q<{ id: string; startsAt: Date; status: string; salonId: string; salonName: string; serviceName: string; priceSnapshot: string }>(
        `SELECT b.id, b.starts_at AS "startsAt", b.status, b.salon_id AS "salonId", s.name AS "salonName",
                ss.name AS "serviceName", b.price_snapshot AS "priceSnapshot"
           FROM bookings b
           JOIN salons s ON s.id = b.salon_id
           JOIN salon_services ss ON ss.id = b.service_id
          WHERE b.user_id = $1
          ORDER BY b.starts_at DESC, b.id DESC
          LIMIT ${RECENT_BOOKINGS}`,
      ),
      q<{ currency: string; balance: string }>(`SELECT currency, balance FROM wallet_balances WHERE user_id = $1`),
      q<{ n: string }>(`SELECT COUNT(*) AS n FROM reviews WHERE user_id = $1`),
      // Status changes target the user row itself; wallet adjustments are recorded against
      // the wallet with the user id in the request payload (AdminWalletController.adjust).
      q<{
        id: string; action: string; success: boolean; createdAt: Date;
        actorId: string; actorName: string | null; actorPhone: string | null; payload: Record<string, unknown> | null;
      }>(
        `SELECT a.id, a.action, a.success, a.created_at AS "createdAt", a.actor_id AS "actorId",
                u.name AS "actorName", u.phone AS "actorPhone", a.payload
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE (a.target_type = 'user' AND a.target_id = $1::text)
             OR (a.action = 'wallet.adjust' AND a.payload->>'userId' = $1::text)
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT ${RECENT_ACTIVITY}`,
      ),
    ]);

    const byStatus: Record<string, number> = {};
    for (const r of statusRows) byStatus[r.status] = Number(r.n);
    const balance = (currency: string) => Number(balances.find((b) => b.currency === currency)?.balance ?? 0);
    const str = (v: unknown) => (typeof v === 'string' ? v : null);

    return {
      user,
      salon: salons[0] ?? null,
      workerAt,
      bookings: {
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
        recent: recent.map((r) => ({ ...r, priceSnapshot: Number(r.priceSnapshot) })),
      },
      wallet: { toman: balance('toman'), points: balance('points') },
      reviewsCount: Number(reviews[0]?.n ?? 0),
      activity: activity.map((a) => {
        const after = (a.payload?.after ?? null) as Record<string, unknown> | null;
        return {
          id: a.id,
          action: a.action,
          success: a.success,
          createdAt: a.createdAt,
          actor: { id: a.actorId, name: a.actorName, phone: a.actorPhone },
          status: a.action === 'user.status.set' ? (str(after?.status) ?? str(a.payload?.status)) : null,
          amount: a.action === 'wallet.adjust' && typeof a.payload?.amount === 'number' ? a.payload.amount : null,
          currency: a.action === 'wallet.adjust' ? (str(a.payload?.currency) ?? 'toman') : null,
          reason: a.action === 'wallet.adjust' ? str(a.payload?.reason) : null,
        };
      }),
    };
  }

  /**
   * Sets a user's status and cascades onto their owned salon in ONE transaction
   * (Plan 7 spec 3.5):
   *  - suspend:    salon WHERE owner_id AND status='approved'
   *                  -> status='suspended', suspended_cause='owner_suspended'
   *  - reactivate: salon WHERE owner_id AND status='suspended' AND suspended_cause='owner_suspended'
   *                  -> status='approved', suspended_cause=NULL
   * A salon an admin suspended directly (suspended_cause='admin') never matches the
   * reactivate WHERE clause, so it stays suspended -- that is the whole point of the cause column.
   */
  async setStatus(actingAdminId: string, targetUserId: string, status: UserStatus): Promise<User> {
    if (targetUserId === actingAdminId) {
      // Persian: this message is surfaced verbatim by the admin panel's toast.
      throw new BadRequestException('تغییر وضعیت حساب خودتان امکان‌پذیر نیست');
    }

    return this.dataSource.transaction(async (em) => {
      const result = await em.update(User, { id: targetUserId }, { status });
      if (!result.affected) throw new NotFoundException();

      if (status === 'suspended') {
        await em.update(
          Salon,
          { ownerId: targetUserId, status: 'approved' },
          { status: 'suspended', suspendedCause: OWNER_SUSPENDED },
        );
      } else {
        await em.update(
          Salon,
          { ownerId: targetUserId, status: 'suspended', suspendedCause: OWNER_SUSPENDED },
          { status: 'approved', suspendedCause: null },
        );
      }

      return (await em.findOneBy(User, { id: targetUserId }))!;
    });
  }
}
