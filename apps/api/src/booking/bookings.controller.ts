import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { User } from '../users/user.entity';
import { BookingsService } from './bookings.service';
import { CreateBookingDto, RescheduleBookingDto } from './dto/booking.dto';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateBookingDto) {
    return this.bookings.createHold((req.user as User).id, dto);
  }

  @Get('mine')
  listMine(@Req() req: Request) {
    return this.bookings.listMine((req.user as User).id);
  }

  @Get(':id')
  findMine(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.findMine((req.user as User).id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.cancel(id, (req.user as User).id);
  }

  @Post(':id/retry-payment')
  @HttpCode(200)
  retryPayment(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.retryPayment((req.user as User).id, id);
  }

  // Customer-initiated move. Allowed only while still inside the cancellation window,
  // measured against the ORIGINAL start -- see BookingsService.reschedule for why that
  // matters (otherwise it is a free escape hatch from deposit forfeiture).
  @Post(':id/reschedule')
  @HttpCode(200)
  reschedule(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleBookingDto) {
    return this.bookings.reschedule(id, dto.startsAt, { type: 'customer', userId: (req.user as User).id });
  }
}
