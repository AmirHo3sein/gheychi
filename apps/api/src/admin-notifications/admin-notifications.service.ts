import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AdminNotification } from './admin-notification.entity';
import { AdminNotificationQueryDto } from './dto/admin-notification-query.dto';

export interface AdminNotificationView {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: Date;
  read_at: Date | null;
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
   * "Read" is per-caller (admin_notification_reads), not a column on the notification
   * itself -- one admin reading a notification must not mark it read for every other
   * admin. LEFT JOINed against the calling admin's own rows only; a notification with
   * no matching read row is unread FOR THIS ADMIN, regardless of any other admin's state.
   */
  async list(query: AdminNotificationQueryDto, adminId: string) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const unreadOnly = query.unread === 'true';
    const whereUnread = unreadOnly ? 'WHERE r.read_at IS NULL' : '';

    const rows: NotificationRow[] = await this.dataSource.query(
      `
      SELECT n.id, n.type, n.title, n.body, n.link, n.created_at, r.read_at
      FROM admin_notifications n
      LEFT JOIN admin_notification_reads r ON r.notification_id = n.id AND r.admin_id = $1
      ${whereUnread}
      ORDER BY n.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [adminId, pageSize, (page - 1) * pageSize],
    );
    const [{ count }]: Array<{ count: number }> = await this.dataSource.query(
      `
      SELECT count(*)::int AS count
      FROM admin_notifications n
      LEFT JOIN admin_notification_reads r ON r.notification_id = n.id AND r.admin_id = $1
      ${whereUnread}
      `,
      [adminId],
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
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
