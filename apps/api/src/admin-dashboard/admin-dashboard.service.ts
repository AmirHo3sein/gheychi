import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { BACKUP_LAST_SUCCESS_KEY } from '../backup-monitoring/backup-report.controller';
import { STALE_AFTER_HOURS } from '../backup-monitoring/backup-staleness-check.job';
import { BookingStatus, DEAD_BOOKING_STATUSES } from '../booking/booking.entity';
import { REDIS } from '../redis/redis.module';
import { SalonStatus } from '../salons/salon.entity';
import { UserRole } from '../users/user.entity';

// Every "day" below is an Asia/Tehran calendar day, computed by Postgres from the `now`
// parameter -- the same boundaries the admin panel's tehran-day.ts uses for its filters.
// `today` is day 0; the 30-day window is today and the 29 days before it.
const SERIES_DAYS = 30;
const TZ = 'Asia/Tehran';

const SALON_STATUSES: SalonStatus[] = ['pending', 'approved', 'rejected', 'suspended'];
const USER_ROLES: UserRole[] = ['customer', 'provider', 'admin'];

export interface DashboardDay {
  date: string; // 'YYYY-MM-DD', Tehran
  created: number; // bookings created that day
  completed: number; // bookings whose appointment was that day and is now `completed`
}

export interface TodayBookings {
  total: number;
  pending: number; // pending_approval + pending_payment
  confirmed: number;
  completed: number;
  noShow: number;
  cancelled: number; // every DEAD_BOOKING_STATUSES member: cancelled_*, rejected_by_salon, expired
  byStatus: Partial<Record<BookingStatus, number>>;
}

export type BackupStatus = 'ok' | 'stale' | 'missing' | 'unknown';

export interface AdminDashboardSummary {
  generatedAt: string;
  today: string; // Tehran date the "today" figures are for
  salons: { byStatus: Record<SalonStatus, number>; total: number };
  users: { byRole: Record<UserRole, number>; suspended: number; total: number };
  bookings: {
    today: TodayBookings;
    last7Days: { created: number; completed: number };
    last30Days: { created: number; completed: number };
    series: DashboardDay[]; // exactly 30 entries, oldest first, zero-filled
    pendingApprovalNow: number;
  };
  payments: { refundPending: number };
  moderation: { openReports: number; pendingCategoryRequests: number };
  // Commission ledger (financial_transactions, commission_accrued rows) for the 30-day
  // window. grossAmount is captured deposit money, never full service price -- see
  // FinancialTransaction's doc comment. Toman.
  revenueLast30Days: { grossAmount: number; commissionAmount: number; accruals: number };
  subscriptions: { byPlan: Array<{ planId: string; planKey: string; planName: string; activeCount: number }> };
  // Per calling admin, matching the bell: an alert this admin has read is not counted.
  alerts: { unreadCritical: number; unreadWarning: number };
  backup: { lastSuccessAt: string | null; status: BackupStatus; staleAfterHours: number };
}

interface ScalarRow {
  today: string;
  salons_by_status: Record<string, number> | null;
  users_by_role: Record<string, number> | null;
  users_suspended: number;
  pending_approval: number;
  refund_pending: number;
  open_reports: number;
  pending_category_requests: number;
  revenue_gross: string;
  revenue_commission: string;
  revenue_rows: number;
  alerts_critical: number;
  alerts_warning: number;
}

/**
 * GET /admin/dashboard-summary. Every number is a DB aggregate (COUNT/SUM ... GROUP BY),
 * never a count over a fetched list page -- the admin dashboard previously counted the
 * first 100 rows of each list client-side and silently undercounted past that.
 *
 * Three independent queries, run concurrently: one row of scalar counts, the zero-filled
 * 30-day series, and the two small grouped lists (today by status, subscriptions by plan).
 */
@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async summary(adminId: string, now: Date = new Date()): Promise<AdminDashboardSummary> {
    const [scalarRows, seriesRows, todayRows, planRows, backup] = await Promise.all([
      this.dataSource.query(SCALAR_SQL, [now, adminId, SERIES_DAYS]) as Promise<ScalarRow[]>,
      this.dataSource.query(SERIES_SQL, [now, SERIES_DAYS]) as Promise<
        Array<{ date: string; created: number; completed: number }>
      >,
      this.dataSource.query(TODAY_SQL, [now]) as Promise<Array<{ status: BookingStatus; count: number }>>,
      this.dataSource.query(PLANS_SQL) as Promise<
        Array<{ plan_id: string; plan_key: string; plan_name: string; active_count: number }>
      >,
      this.backupStatus(now),
    ]);
    const s = scalarRows[0];

    const salonsByStatus = Object.fromEntries(
      SALON_STATUSES.map((st) => [st, Number(s.salons_by_status?.[st] ?? 0)]),
    ) as Record<SalonStatus, number>;
    const usersByRole = Object.fromEntries(USER_ROLES.map((r) => [r, Number(s.users_by_role?.[r] ?? 0)])) as Record<
      UserRole,
      number
    >;

    const series: DashboardDay[] = seriesRows.map((r) => ({
      date: r.date,
      created: Number(r.created),
      completed: Number(r.completed),
    }));
    const window = (days: number) =>
      series.slice(-days).reduce(
        (acc, d) => ({ created: acc.created + d.created, completed: acc.completed + d.completed }),
        { created: 0, completed: 0 },
      );

    return {
      generatedAt: now.toISOString(),
      today: s.today,
      salons: { byStatus: salonsByStatus, total: sumValues(salonsByStatus) },
      users: { byRole: usersByRole, suspended: Number(s.users_suspended), total: sumValues(usersByRole) },
      bookings: {
        today: groupToday(todayRows),
        last7Days: window(7),
        last30Days: window(SERIES_DAYS),
        series,
        pendingApprovalNow: Number(s.pending_approval),
      },
      payments: { refundPending: Number(s.refund_pending) },
      moderation: {
        openReports: Number(s.open_reports),
        pendingCategoryRequests: Number(s.pending_category_requests),
      },
      revenueLast30Days: {
        grossAmount: Number(s.revenue_gross),
        commissionAmount: Number(s.revenue_commission),
        accruals: Number(s.revenue_rows),
      },
      subscriptions: {
        byPlan: planRows.map((p) => ({
          planId: p.plan_id,
          planKey: p.plan_key,
          planName: p.plan_name,
          activeCount: Number(p.active_count),
        })),
      },
      alerts: { unreadCritical: Number(s.alerts_critical), unreadWarning: Number(s.alerts_warning) },
      backup,
    };
  }

  // Same reading BackupStalenessCheckJob does: missing and unparseable both mean "no known
  // good backup". A Redis error is 'unknown' rather than a 500 -- the rest of the dashboard
  // is still worth showing when only Redis is down.
  private async backupStatus(now: Date): Promise<AdminDashboardSummary['backup']> {
    const base = { staleAfterHours: STALE_AFTER_HOURS };
    let raw: string | null;
    try {
      raw = await this.redis.get(BACKUP_LAST_SUCCESS_KEY);
    } catch (err) {
      this.logger.warn(`Backup status read failed: ${err instanceof Error ? err.message : String(err)}`);
      return { ...base, lastSuccessAt: null, status: 'unknown' };
    }
    if (!raw) return { ...base, lastSuccessAt: null, status: 'missing' };
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) return { ...base, lastSuccessAt: null, status: 'missing' };
    const hoursSince = (now.getTime() - at.getTime()) / 3_600_000;
    return { ...base, lastSuccessAt: at.toISOString(), status: hoursSince > STALE_AFTER_HOURS ? 'stale' : 'ok' };
  }
}

function sumValues(record: Record<string, number>): number {
  return Object.values(record).reduce((a, b) => a + b, 0);
}

export function groupToday(rows: Array<{ status: BookingStatus; count: number }>): TodayBookings {
  const byStatus: Partial<Record<BookingStatus, number>> = {};
  for (const r of rows) byStatus[r.status] = Number(r.count);
  const n = (st: BookingStatus) => byStatus[st] ?? 0;
  return {
    total: Object.values(byStatus).reduce((a, b) => a + (b ?? 0), 0),
    pending: n('pending_approval') + n('pending_payment'),
    confirmed: n('confirmed'),
    completed: n('completed'),
    noShow: n('no_show'),
    cancelled: DEAD_BOOKING_STATUSES.reduce((acc, st) => acc + n(st), 0),
    byStatus,
  };
}

// $1 = now, $2 = calling admin id, $3 = series length in days.
const SCALAR_SQL = `
  WITH b AS (
    SELECT ($1::timestamptz AT TIME ZONE '${TZ}')::date AS today
  ), w AS (
    SELECT today, ((today - ($3::int - 1))::timestamp AT TIME ZONE '${TZ}') AS window_start FROM b
  )
  SELECT
    to_char(w.today, 'YYYY-MM-DD') AS today,
    (SELECT json_object_agg(status, c) FROM (SELECT status, count(*)::int AS c FROM salons GROUP BY status) x)
      AS salons_by_status,
    (SELECT json_object_agg(role, c) FROM (SELECT role, count(*)::int AS c FROM users GROUP BY role) x)
      AS users_by_role,
    (SELECT count(*)::int FROM users WHERE status = 'suspended') AS users_suspended,
    (SELECT count(*)::int FROM bookings WHERE status = 'pending_approval') AS pending_approval,
    (SELECT count(*)::int FROM payments WHERE status = 'refund_pending') AS refund_pending,
    (SELECT count(*)::int FROM reports WHERE status = 'open') AS open_reports,
    (SELECT count(*)::int FROM category_requests WHERE status = 'pending') AS pending_category_requests,
    ft.gross::text AS revenue_gross,
    ft.commission::text AS revenue_commission,
    ft.rows AS revenue_rows,
    al.critical AS alerts_critical,
    al.warning AS alerts_warning
  FROM w
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(gross_amount), 0) AS gross, COALESCE(sum(commission_amount), 0) AS commission,
           count(*)::int AS rows
    FROM financial_transactions
    WHERE type = 'commission_accrued' AND created_at >= w.window_start
  ) ft
  CROSS JOIN LATERAL (
    -- Severity read exactly as AdminNotificationsService.severityOf does: a pre-column
    -- alert (NULL) counts as a warning, never as critical.
    SELECT count(*) FILTER (WHERE n.severity = 'critical')::int AS critical,
           count(*) FILTER (WHERE n.severity IS DISTINCT FROM 'critical')::int AS warning
    FROM admin_notifications n
    LEFT JOIN admin_notification_reads r ON r.notification_id = n.id AND r.admin_id = $2
    WHERE n.type = 'alert' AND r.read_at IS NULL
  ) al
`;

// $1 = now, $2 = series length. Range predicates on the raw timestamptz (index-friendly),
// bucketed by Tehran date afterwards; generate_series zero-fills the empty days.
const SERIES_SQL = `
  WITH b AS (
    SELECT ($1::timestamptz AT TIME ZONE '${TZ}')::date AS today
  ), w AS (
    SELECT today,
           ((today - ($2::int - 1))::timestamp AT TIME ZONE '${TZ}') AS window_start,
           ((today + 1)::timestamp AT TIME ZONE '${TZ}') AS window_end
    FROM b
  ), days AS (
    SELECT d::date AS day FROM w, generate_series(w.today - ($2::int - 1), w.today, interval '1 day') d
  ), created AS (
    SELECT (bk.created_at AT TIME ZONE '${TZ}')::date AS day, count(*)::int AS c
    FROM bookings bk, w
    WHERE bk.created_at >= w.window_start AND bk.created_at < w.window_end
    GROUP BY 1
  ), completed AS (
    SELECT (bk.starts_at AT TIME ZONE '${TZ}')::date AS day, count(*)::int AS c
    FROM bookings bk, w
    WHERE bk.status = 'completed' AND bk.starts_at >= w.window_start AND bk.starts_at < w.window_end
    GROUP BY 1
  )
  SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
         COALESCE(created.c, 0) AS created,
         COALESCE(completed.c, 0) AS completed
  FROM days
  LEFT JOIN created ON created.day = days.day
  LEFT JOIN completed ON completed.day = days.day
  ORDER BY days.day
`;

// $1 = now. Today's appointments (starts_at within the Tehran day), by current status.
const TODAY_SQL = `
  WITH b AS (
    SELECT ($1::timestamptz AT TIME ZONE '${TZ}')::date AS today
  )
  SELECT bk.status, count(*)::int AS count
  FROM bookings bk, b
  WHERE bk.starts_at >= (b.today::timestamp AT TIME ZONE '${TZ}')
    AND bk.starts_at < ((b.today + 1)::timestamp AT TIME ZONE '${TZ}')
  GROUP BY bk.status
`;

// Every plan, including ones with no active salon, in the admin's own display order.
const PLANS_SQL = `
  SELECT p.id AS plan_id, p.key AS plan_key, p.name AS plan_name, count(s.id)::int AS active_count
  FROM plans p
  LEFT JOIN salon_subscriptions s ON s.plan_id = p.id AND s.status = 'active'
  GROUP BY p.id, p.key, p.name, p.sort_order
  ORDER BY p.sort_order, p.name
`;
