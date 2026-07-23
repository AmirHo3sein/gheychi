import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { AssignWorkerDto } from '../salons/dto/worker.dto';
import { BookingsService } from './bookings.service';
import { UpdateBookingStatusDto } from './dto/booking.dto';

@Controller('salons/mine/bookings')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list(@Req() req: Request) {
    return this.bookings.listForSalon(req.salonId!);
  }

  @Patch(':id')
  updateStatus(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.bookings.updateStatus(req.salonId!, id, dto.status);
  }

  @Patch(':id/assign-worker')
  assignWorker(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignWorkerDto,
  ) {
    return this.bookings.assignWorker(req.salonId!, id, dto.workerId);
  }
}
