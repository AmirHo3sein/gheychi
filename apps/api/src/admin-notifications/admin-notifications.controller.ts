import { Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminNotificationsService } from './admin-notifications.service';
import { AdminNotificationQueryDto } from './dto/admin-notification-query.dto';

@Controller('admin/notifications')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminNotificationsController {
  constructor(private readonly notifications: AdminNotificationsService) {}

  @Get()
  list(@Query() query: AdminNotificationQueryDto) {
    return this.notifications.list(query);
  }

  @Get('unread-count')
  async unreadCount() {
    return { count: await this.notifications.unreadCount() };
  }

  @Patch(':id/read')
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(id);
  }

  @Post('read-all')
  async readAll() {
    await this.notifications.markAllRead();
    return { ok: true };
  }
}
