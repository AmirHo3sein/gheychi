import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AssignPlanDto } from './dto/subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller('admin/salons/:salonId/subscription')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminSalonSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  get(@Param('salonId', ParseUUIDPipe) salonId: string) {
    return this.subscriptions.getForSalon(salonId);
  }

  @Patch()
  @UseInterceptors(AuditInterceptor)
  @AuditAction('subscription.plan.set', 'salon-subscription', 'salonId')
  async assign(@Param('salonId', ParseUUIDPipe) salonId: string, @Body() dto: AssignPlanDto, @Req() req: Request) {
    const before = await this.subscriptions.getForSalon(salonId).catch(() => null);
    if (before) req.auditBefore = { planId: before.subscription.planId, status: before.subscription.status };

    const result = await this.subscriptions.assignPlan(salonId, dto.planId);
    req.auditAfter = { planId: result.subscription.planId, status: result.subscription.status };
    return result;
  }

  @Post('cancel')
  @HttpCode(200)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('subscription.cancel', 'salon-subscription', 'salonId')
  async cancel(@Param('salonId', ParseUUIDPipe) salonId: string, @Req() req: Request) {
    const before = await this.subscriptions.getForSalon(salonId).catch(() => null);
    if (before) req.auditBefore = { planId: before.subscription.planId, status: before.subscription.status };

    const result = await this.subscriptions.cancel(salonId);
    req.auditAfter = { planId: result.subscription.planId, status: result.subscription.status };
    return result;
  }
}
