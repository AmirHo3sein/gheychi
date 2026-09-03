import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminBookingQueryDto } from './dto/admin-booking-query.dto';

/**
 * The admin-side booking browser: the entry point that makes the existing per-booking
 * support timeline (`GET /admin/bookings/:id/events`, AdminBookingSettingsController)
 * reachable. Before this route existed an admin could only open that timeline by
 * hand-typing a booking UUID obtained outside the product, which made handling a dispute
 * or finding a stuck `refund_pending` payment effectively impossible.
 *
 * STRICTLY READ-ONLY, and permanently so. Every booking transition is guarded by real
 * invariants in BookingsService's state machine -- per-salon Redis locks, capacity and
 * worker re-checks, CAS'd status flips, coupon/wallet hold release, commission accrual,
 * refund initiation. An admin mutation route here would have to either duplicate all of
 * that or bypass it, and bypassing it is how a slot gets double-booked or money gets
 * captured against a dead booking. If an admin genuinely needs to change a booking, the
 * correct answer is a new, explicitly-modelled transition inside that state machine (with
 * its own booking_events + audit_log rows), never a generic write endpoint here.
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
  constructor(private readonly adminBookings: AdminBookingsService) {}

  @Get()
  list(@Query() query: AdminBookingQueryDto) {
    return this.adminBookings.list(query);
  }
}
