import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { BookingsService } from './bookings.service';

@Controller('salons/mine/earnings')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonEarningsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  earnings(@Req() req: Request) {
    return this.bookings.getEarnings(req.salonId!);
  }
}
