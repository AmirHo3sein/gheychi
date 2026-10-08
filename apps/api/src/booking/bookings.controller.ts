import {
  Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Req,
} from '@nestjs/common';
import { Request } from 'express';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { User } from '../users/user.entity';
import { BookingsService } from './bookings.service';
import { CreateBookingDto, RescheduleBookingDto } from './dto/booking.dto';

// Per-customer ceiling on booking-creation ATTEMPTS (successful or not), same Redis
// INCR+EXPIRE idiom as OtpService.issue and ReferralsController.validate. Generous for a
// real person -- the active-booking caps are the real limit -- but stops a script from
// hammering the slot lock and the payment gateway.
export const BOOKING_CREATE_RATE_LIMIT_MAX = 15;
export const BOOKING_CREATE_RATE_WINDOW_SEC = 600;

@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Post()
  async create(@Req() req: Request, @Body() dto: CreateBookingDto) {
    const userId = (req.user as User).id;
    const rlKey = `booking:create:rl:${userId}`;
    const count = await this.redis.incr(rlKey);
    // Also repairs a key that lost its TTL (crash between INCR and EXPIRE): without this the user would stay rate-limited forever.
    if (count === 1 || (await this.redis.ttl(rlKey)) === -1) await this.redis.expire(rlKey, BOOKING_CREATE_RATE_WINDOW_SEC);
    if (count > BOOKING_CREATE_RATE_LIMIT_MAX) {
      throw new HttpException('تعداد درخواست‌های ثبت نوبت بیش از حد است؛ کمی بعد دوباره تلاش کنید', HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.bookings.createHold(userId, dto);
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
