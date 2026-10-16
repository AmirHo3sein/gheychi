import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { SalonCapacityQueryDto } from './dto/booking.dto';
import { SalonCapacityService } from './salon-capacity.service';

// Its own controller rather than a route on SalonBookingsController: the path is
// salons/mine/capacity, not under salons/mine/bookings.
@Controller('salons/mine/capacity')
@UseGuards(SalonOwnerGuard)
export class SalonCapacityController {
  constructor(private readonly capacity: SalonCapacityService) {}

  @Get()
  get(@Req() req: Request, @Query() query: SalonCapacityQueryDto) {
    return this.capacity.compute(req.salonId!, query);
  }
}
