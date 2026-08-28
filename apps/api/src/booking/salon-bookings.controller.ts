import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { Request } from 'express';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
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
  //
  // Both carry @AuditAction as well as writing a booking_events row, and that is not
  // duplication of the same record -- the two answer different questions and only one of
  // them can answer either. `audit_log.actor_id` is NOT NULL, so it can only ever hold
  // transitions a real person performed: it is the "who did this, and can we hold them to
  // it" ledger, browsable by actor across the whole platform. Approve/reject are exactly
  // that, which is why they belong there. The cron-driven halves of this same state
  // machine (approval expiry, payment expiry) have no actor at all and are structurally
  // unable to live in audit_log, which is why booking_events exists and why it -- not
  // audit_log -- is what reconstructs one booking's full lifecycle.
  @Post(':id/approve')
  @HttpCode(200)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('booking.approval.approved', 'booking')
  async approve(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const before = await this.bookings.findForSalonAudit(req.salonId!, id);
    if (before) req.auditBefore = before;
    const updated = await this.bookings.approve(req.salonId!, id, (req.user as User).id);
    req.auditAfter = { status: updated.status, paymentExpiresAt: updated.paymentExpiresAt };
    return updated;
  }

  @Post(':id/reject')
  @HttpCode(200)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('booking.approval.rejected', 'booking')
  async reject(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectBookingDto) {
    const before = await this.bookings.findForSalonAudit(req.salonId!, id);
    if (before) req.auditBefore = before;
    const updated = await this.bookings.reject(req.salonId!, id, (req.user as User).id, dto.reason);
    req.auditAfter = { status: updated.status };
    return updated;
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
