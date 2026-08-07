import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { User } from '../users/user.entity';
import { AdminNotificationsService } from './admin-notifications.service';
import { AdminNotificationQueryDto } from './dto/admin-notification-query.dto';

@Controller('admin/notifications')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminNotificationsController {
  constructor(private readonly notifications: AdminNotificationsService) {}

  @Get()
  list(@Query() query: AdminNotificationQueryDto, @Req() req: Request) {
    return this.notifications.list(query, (req.user as User).id);
  }

  @Get('unread-count')
  async unreadCount(@Req() req: Request) {
    return { count: await this.notifications.unreadCount((req.user as User).id) };
  }

  @Patch(':id/read')
  markRead(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.notifications.markRead(id, (req.user as User).id);
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@Req() req: Request) {
    await this.notifications.markAllRead((req.user as User).id);
    return { ok: true };
  }
}
