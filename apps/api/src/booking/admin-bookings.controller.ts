import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { User } from '../users/user.entity';
import { AdminBookingsService } from './admin-bookings.service';
import { BookingsService } from './bookings.service';
import { AdminBookingQueryDto } from './dto/admin-booking-query.dto';
import { AdminCancelBookingDto } from './dto/booking.dto';

/**
 * The admin-side booking browser: the entry point that makes the existing per-booking
 * support timeline (`GET /admin/bookings/:id/events`, AdminBookingSettingsController)
 * reachable. Before this route existed an admin could only open that timeline by
 * hand-typing a booking UUID obtained outside the product, which made handling a dispute
 * or finding a stuck `refund_pending` payment effectively impossible.
 *
 * The LIST is strictly read-only, and the only write here is the one explicitly modelled
 * transition, `POST :id/cancel` (platform cancellation), which delegates to
 * BookingsService.adminCancel rather than touching rows itself. Every booking transition is guarded by real
 * invariants in BookingsService's state machine -- per-salon Redis locks, capacity and
 * worker re-checks, CAS'd status flips, coupon/wallet hold release, commission accrual,
 * refund initiation. An admin mutation route here would have to either duplicate all of
 * that or bypass it, and bypassing it is how a slot gets double-booked or money gets
 * captured against a dead booking. If an admin genuinely needs to change a booking, the
 * correct answer is a new, explicitly-modelled transition inside that state machine (with
 * its own booking_events + audit_log rows), never a generic write endpoint here -- which
 * is exactly what adminCancel is.
 *
 * Note the sibling controller: this is `admin/bookings` while the timeline route lives on
 * AdminBookingSettingsController's `admin` prefix as `bookings/:id/events`. They are
 * different paths and do not collide.
 */
@Controller('admin/bookings')
// AuthGuard is applied globally via APP_GUARD (app.module.ts) -- listing it here too would
// be redundant. RolesGuard + @Roles('admin') is the whole access-control story, matching
// AdminSalonsController/AdminInvoicesController.
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminBookingsController {
  constructor(
    private readonly adminBookings: AdminBookingsService,
    private readonly bookings: BookingsService,
  ) {}

  @Get()
  list(@Query() query: AdminBookingQueryDto) {
    return this.adminBookings.list(query);
  }

  // @HttpCode(200): transitions an existing booking, like POST /bookings/:id/cancel. The
  // audit row's payload is the request body (the reason); booking_events (via the service)
  // additionally records the booking's prior status.
  @Post(':id/cancel')
  @HttpCode(200)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('booking.cancelled_by_admin', 'booking', 'id')
  cancel(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminCancelBookingDto) {
    return this.bookings.adminCancel(id, (req.user as User).id, dto.reason);
  }
}
