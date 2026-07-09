import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { AdminNotification } from './admin-notification.entity';
import { AdminNotificationQueryDto } from './dto/admin-notification-query.dto';

@Injectable()
export class AdminNotificationsService {
  constructor(
    @InjectRepository(AdminNotification) private readonly repo: Repository<AdminNotification>,
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

  async list(query: AdminNotificationQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.repo.findAndCount({
      where: query.unread === 'true' ? { readAt: IsNull() } : {},
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  unreadCount(): Promise<number> {
    return this.repo.countBy({ readAt: IsNull() });
  }

  async markRead(id: string): Promise<AdminNotification> {
    const notification = await this.repo.findOneBy({ id });
    if (!notification) throw new NotFoundException();
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.repo.save(notification);
    }
    return notification;
  }

  async markAllRead(): Promise<void> {
    await this.repo.update({ readAt: IsNull() }, { readAt: new Date() });
  }
}
