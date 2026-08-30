import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateSubscriptionCouponDto, UpdateSubscriptionCouponDto } from './dto/subscription-coupon.dto';
import { SubscriptionCoupon } from './subscription-coupon.entity';
import { SubscriptionCouponsService } from './subscription-coupons.service';

@Controller('admin/subscription-coupons')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminSubscriptionCouponsController {
  constructor(
    private readonly coupons: SubscriptionCouponsService,
    @InjectRepository(SubscriptionCoupon) private readonly couponsRepo: Repository<SubscriptionCoupon>,
  ) {}

  @Post()
  @UseInterceptors(AuditInterceptor)
  @AuditAction('subscription-coupon.create', 'subscription-coupon')
  create(@Body() dto: CreateSubscriptionCouponDto) {
    return this.coupons.create(dto);
  }

  @Get()
  list() {
    return this.coupons.list();
  }

  @Patch(':id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('subscription-coupon.update', 'subscription-coupon')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSubscriptionCouponDto, @Req() req: Request) {
    const before = await this.couponsRepo.findOneBy({ id });
    if (before) {
      req.auditBefore = {
        discountPercent: before.discountPercent,
        expiresAt: before.expiresAt,
        maxRedemptions: before.maxRedemptions,
        isActive: before.isActive,
      };
    }

    const updated = await this.coupons.update(id, dto);
    req.auditAfter = {
      discountPercent: updated.discountPercent,
      expiresAt: updated.expiresAt,
      maxRedemptions: updated.maxRedemptions,
      isActive: updated.isActive,
    };
    return updated;
  }

  @Delete(':id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('subscription-coupon.delete', 'subscription-coupon')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const before = await this.couponsRepo.findOneBy({ id });
    if (before) req.auditBefore = { isActive: before.isActive };

    await this.coupons.deactivate(id);
    req.auditAfter = { isActive: false };
  }
}
