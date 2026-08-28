import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { AssignWorkerDto } from '../salons/dto/worker.dto';
import { BookingsService } from './bookings.service';
import { User } from '../users/user.entity';
import { CreateManualBookingDto, RejectBookingDto, UpdateBookingStatusDto } from './dto/booking.dto';

@Controller('salons/mine/bookings')
@UseGuards(SalonOwnerGuard)
export class SalonBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  list(@Req() req: Request) {
    return this.bookings.listForSalon(req.salonId!);
  }

  // A customer who called or walked in -- not in the system at all. See
  // BookingsService.createManual's own comment for the full design.
  @Post()
  createManual(@Req() req: Request, @Body() dto: CreateManualBookingDto) {
    return this.bookings.createManual(req.salonId!, dto);
  }

  @Patch(':id')
  updateStatus(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.bookings.updateStatus(req.salonId!, id, dto.status);
  }

  // Manual-approval mode. Both routes are scoped by the controller's SalonOwnerGuard,
  // and the service re-scopes its lookup by req.salonId on top of that -- an owner can
  // never act on another salon's request even with a valid booking id.
  // @HttpCode(200), not Nest's POST default of 201: these transition an existing booking
  // rather than creating a resource -- matching the house style already set by
  // POST /bookings/:id/cancel and POST /bookings/:id/retry-payment.
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.approve(req.salonId!, id, (req.user as User).id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectBookingDto) {
    return this.bookings.reject(req.salonId!, id, (req.user as User).id, dto.reason);
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
