import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { User } from '../users/user.entity';
import { AdminDashboardService } from './admin-dashboard.service';

// AuthGuard runs globally; RolesGuard + @Roles('admin') is the whole guard setup, same as
// AdminAnalyticsController.
@Controller('admin/dashboard-summary')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  // The caller's id scopes only the unread-alert counts (read state is per admin).
  @Get()
  summary(@Req() req: Request) {
    return this.dashboard.summary((req.user as User).id);
  }
}
