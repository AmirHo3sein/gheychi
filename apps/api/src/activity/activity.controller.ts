import { Controller, Get, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { User } from '../users/user.entity';
import { ActivityService } from './activity.service';

@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  // AuthGuard runs globally (no @Public()) -- every authenticated user's own history,
  // provider or customer alike, since a provider account is also a customer per the
  // domain model and should see their own bookings/reviews too.
  @Get('mine')
  listMine(@Req() req: Request, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const parsedLimit = limit !== undefined ? Number(limit) : undefined;
    const safeLimit = parsedLimit !== undefined && Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    return this.activity.listMine((req.user as User).id, cursor, safeLimit);
  }
}
