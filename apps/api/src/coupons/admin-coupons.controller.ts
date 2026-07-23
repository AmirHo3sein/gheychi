import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CouponsService } from './coupons.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

@Controller('admin/coupons')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminCouponsController {
  constructor(private readonly coupons: CouponsService) {}

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

  @Patch(':id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('coupon.update', 'coupon')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto) {
    return this.coupons.updateScoped(id, null, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('coupon.delete', 'coupon')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.coupons.deactivateScoped(id, null);
  }
}
