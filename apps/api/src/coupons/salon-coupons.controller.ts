import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { CouponsService } from './coupons.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

@Controller('salons/mine/coupons')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateCouponDto) {
    return this.coupons.createForSalon(req.salonId!, dto);
  }

  @Get()
  list(@Req() req: Request) {
    return this.coupons.listForSalon(req.salonId!);
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCouponDto) {
    return this.coupons.updateScoped(id, req.salonId!, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.coupons.deactivateScoped(id, req.salonId!);
  }
}
