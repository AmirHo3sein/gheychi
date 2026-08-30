import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateBillingPeriodDto, SetBillingPeriodStatusDto } from './dto/billing-period.dto';
import { SubscriptionBillingPeriod } from './subscription-billing-period.entity';
import { SubscriptionBillingService } from './subscription-billing.service';

@Controller('admin/salons/:salonId/subscription/billing-periods')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminSubscriptionBillingController {
  constructor(
    private readonly billing: SubscriptionBillingService,
    @InjectRepository(SubscriptionBillingPeriod) private readonly periodsRepo: Repository<SubscriptionBillingPeriod>,
  ) {}

  @Get()
  list(@Param('salonId', ParseUUIDPipe) salonId: string) {
    return this.billing.listForSalon(salonId);
  }

  @Post()
  @UseInterceptors(AuditInterceptor)
  @AuditAction('subscription.billing-period.create', 'subscription-billing-period', 'salonId')
  async create(@Param('salonId', ParseUUIDPipe) salonId: string, @Body() dto: CreateBillingPeriodDto, @Req() req: Request) {
    const period = await this.billing.createPeriod(salonId, dto);
    req.auditAfter = { periodStart: period.periodStart, periodEnd: period.periodEnd, amountToman: period.amountToman };
    return period;
  }

  @Patch(':periodId/status')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('subscription.billing-period.status.set', 'subscription-billing-period', 'periodId')
  async setStatus(@Param('periodId', ParseUUIDPipe) periodId: string, @Body() dto: SetBillingPeriodStatusDto, @Req() req: Request) {
    const before = await this.periodsRepo.findOneBy({ id: periodId });
    if (before) req.auditBefore = { status: before.status };

    const period = await this.billing.setStatus(periodId, dto.status);
    req.auditAfter = { status: period.status };
    return period;
  }
}
