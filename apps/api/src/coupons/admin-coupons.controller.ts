import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { IsNull, Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Coupon } from './coupon.entity';
import { CouponsService } from './coupons.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

@Controller('admin/coupons')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminCouponsController {
  constructor(
    private readonly coupons: CouponsService,
    @InjectRepository(Coupon) private readonly couponsRepo: Repository<Coupon>,
  ) {}

  @Post()
  @UseInterceptors(AuditInterceptor)
  @AuditAction('coupon.create', 'coupon')
  create(@Body() dto: CreateCouponDto) {
    return this.coupons.createPlatformWide(dto);
  }

  @Get()
  list() {
    return this.coupons.listPlatformWide();
  }

  // Real before/after diff for AuditInterceptor (see its doc comment). Left
  // unset (falls back to the raw request body) when the coupon doesn't exist
  // in this scope -- CouponsService.updateScoped below still 404s exactly as
  // before, this fetch just can't contribute a "before" snapshot in that case.
  @Patch(':id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('coupon.update', 'coupon')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto, @Req() req: Request) {
    const before = await this.couponsRepo.findOneBy({ id, salonId: IsNull() });
    if (before) {
      req.auditBefore = {
        code: before.code,
        discountPercent: before.discountPercent,
        discountFixedAmount: before.discountFixedAmount,
        expiresAt: before.expiresAt,
        maxRedemptions: before.maxRedemptions,
        isActive: before.isActive,
      };
    }

    const updated = await this.coupons.updateScoped(id, null, dto);
    req.auditAfter = {
      code: updated.code,
      discountPercent: updated.discountPercent,
      discountFixedAmount: updated.discountFixedAmount,
      expiresAt: updated.expiresAt,
      maxRedemptions: updated.maxRedemptions,
      isActive: updated.isActive,
    };
    return updated;
  }

  // "Delete" is really a deactivation (CouponsService.deactivateScoped just
  // flips isActive false) -- real prior isActive state is worth capturing here,
  // same reasoning as user/salon status-set. Left unset when the coupon doesn't
  // exist in this scope; deactivateScoped below still 404s as before.
  @Delete(':id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('coupon.delete', 'coupon')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const before = await this.couponsRepo.findOneBy({ id, salonId: IsNull() });
    if (before) req.auditBefore = { isActive: before.isActive };

    await this.coupons.deactivateScoped(id, null);
    req.auditAfter = { isActive: false };
  }
}
