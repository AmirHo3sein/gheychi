import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AdminNotification, AlertSeverity, NotificationSeverity } from './admin-notification.entity';
import { AdminNotificationQueryDto } from './dto/admin-notification-query.dto';

export interface AdminNotificationView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  severity: NotificationSeverity;
  readAt: Date | null;
  createdAt: Date;
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  severity: AlertSeverity | null;
  created_at: Date;
  read_at: Date | null;
}

/**
 * The severity the admin panel shows. An alert keeps the severity it was raised with; an
 * alert from before the column existed (NULL) reads as 'warning' -- never 'critical', since
 * nothing records that it was one. Every non-alert type is 'info'.
 */
export function severityOf(type: string, stored: AlertSeverity | null): NotificationSeverity {
  if (type !== 'alert') return 'info';
  return stored ?? 'warning';
}

/**
 * severityOf() as a SQL expression over `admin_notifications n`, for filtering and counting
 * in the database. MUST stay in lockstep with severityOf() above -- the e2e suite asserts the
 * two agree (an old NULL-severity alert filters and counts as 'warning').
 */
const EFFECTIVE_SEVERITY_SQL = `(CASE WHEN n.type <> 'alert' THEN 'info' ELSE COALESCE(n.severity, 'warning') END)`;

export interface UnreadCounts {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

@Injectable()
export class AdminNotificationsService {
  constructor(
    @InjectRepository(AdminNotification) private readonly repo: Repository<AdminNotification>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Insert a notification row. When a manager is provided the insert joins the
   * caller's transaction (report creation does this so the notification and the
   * report commit or roll back together); otherwise the service's own repository
   * is used. THROWS on failure — each caller decides whether to swallow.
   */
  async emit(
    type: string,
    title: string,
    body: string | null,
    link: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    const row = { type, title, body, link };
    if (manager) {
      await manager.getRepository(AdminNotification).insert(row);
    } else {
      await this.repo.insert(row);
    }
  }

  /**
   * AlertsService's write path: an `alert` row that also records the severity it was raised
   * with. Same throw-on-failure contract as emit().
   */
  async emitAlert(severity: AlertSeverity, title: string, body: string | null, link: string | null): Promise<void> {
    await this.repo.insert({ type: 'alert', title, body, link, severity });
  }

  /**
   * "Read" is per-caller (admin_notification_reads), not a column on the notification
   * itself -- one admin reading a notification must not mark it read for every other
   * admin. LEFT JOINed against the calling admin's own rows only; a notification with
   * no matching read row is unread FOR THIS ADMIN, regardless of any other admin's state.
   */
  async list(query: AdminNotificationQueryDto, adminId: string) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // $1 is always the caller's admin id; each optional filter appends its own bound
    // parameter. Values never reach the SQL text -- only these fixed predicate strings do.
    const params: unknown[] = [adminId];
    const conditions: string[] = [];
    if (query.unread === 'true') conditions.push('r.read_at IS NULL');
    if (query.type) {
      params.push(query.type);
      conditions.push(`n.type = $${params.length}`);
    }
    if (query.severity) {
      params.push(query.severity);
      conditions.push(`${EFFECTIVE_SEVERITY_SQL} = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows: NotificationRow[] = await this.dataSource.query(
      `
      SELECT n.id, n.type, n.title, n.body, n.link, n.severity, n.created_at, r.read_at
      FROM admin_notifications n
      LEFT JOIN admin_notification_reads r ON r.notification_id = n.id AND r.admin_id = $1
      ${where}
      ORDER BY n.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, pageSize, (page - 1) * pageSize],
    );
    const [{ count }]: Array<{ count: number }> = await this.dataSource.query(
      `
      SELECT count(*)::int AS count
      FROM admin_notifications n
      LEFT JOIN admin_notification_reads r ON r.notification_id = n.id AND r.admin_id = $1
      ${where}
      `,
      params,
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        severity: severityOf(row.type, row.severity),
        readAt: row.read_at,
        createdAt: row.created_at,
      })),
      total: count,
      page,
      pageSize,
    };
  }

  async unreadCount(adminId: string): Promise<number> {
    const [{ count }]: Array<{ count: number }> = await this.dataSource.query(
      `
      SELECT count(*)::int AS count
      FROM admin_notifications n
      LEFT JOIN admin_notification_reads r ON r.notification_id = n.id AND r.admin_id = $1
      WHERE r.read_at IS NULL
      `,
      [adminId],
    );
    return count;
  }

  /**
   * The caller's unread notifications broken down by DISPLAYED severity (severityOf):
   * a pre-column alert (stored NULL) counts as 'warning', every non-alert row as 'info'.
   * One aggregate query, so the admin bell can poll it as cheaply as unread-count.
   */
  async unreadCounts(adminId: string): Promise<UnreadCounts> {
    const [row]: Array<UnreadCounts> = await this.dataSource.query(
      `
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE ${EFFECTIVE_SEVERITY_SQL} = 'critical')::int AS critical,
        count(*) FILTER (WHERE ${EFFECTIVE_SEVERITY_SQL} = 'warning')::int AS warning,
        count(*) FILTER (WHERE ${EFFECTIVE_SEVERITY_SQL} = 'info')::int AS info
      FROM admin_notifications n
      LEFT JOIN admin_notification_reads r ON r.notification_id = n.id AND r.admin_id = $1
      WHERE r.read_at IS NULL
      `,
      [adminId],
    );
    return { total: row.total, critical: row.critical, warning: row.warning, info: row.info };
  }

  async markRead(id: string, adminId: string): Promise<AdminNotificationView> {
    const notification = await this.repo.findOneBy({ id });
    if (!notification) throw new NotFoundException();

    // ON CONFLICT DO UPDATE with a harmless self-set (not DO NOTHING), so RETURNING
    // always yields a row -- whether this call created the read or a prior call by
    // this same admin already did (idempotent: read_at is left untouched on conflict).
    const [{ read_at }]: Array<{ read_at: Date }> = await this.dataSource.query(
      `
      INSERT INTO admin_notification_reads (notification_id, admin_id, read_at)
      VALUES ($1, $2, now())
      ON CONFLICT (notification_id, admin_id) DO UPDATE SET admin_id = EXCLUDED.admin_id
      RETURNING read_at
      `,
      [id, adminId],
    );

    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      severity: severityOf(notification.type, notification.severity),
      readAt: read_at,
      createdAt: notification.createdAt,
    };
  }

  async markAllRead(adminId: string): Promise<void> {
    await this.dataSource.query(
      `
      INSERT INTO admin_notification_reads (notification_id, admin_id, read_at)
      SELECT n.id, $1, now()
      FROM admin_notifications n
      WHERE NOT EXISTS (
        SELECT 1 FROM admin_notification_reads r WHERE r.notification_id = n.id AND r.admin_id = $1
      )
      `,
      [adminId],
    );
  }
}
