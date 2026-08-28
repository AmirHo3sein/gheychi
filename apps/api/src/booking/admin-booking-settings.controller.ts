import {
  Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Req, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Salon } from '../salons/salon.entity';
import { BookingEventsService } from './booking-events.service';
import { BookingSettingsService } from './booking-settings.service';
import { UpdateSalonBookingSettingsDto } from './dto/booking-settings.dto';

/**
 * Admin-only control over booking TIMING. Deliberately a separate route from
 * `PATCH /salons/mine` (where the owner picks their mode): the split is the enforcement
 * mechanism for "owners choose the workflow, the platform chooses the deadlines", not
 * merely a URL-organisation preference.
 */
@Controller('admin')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminBookingSettingsController {
  constructor(
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    private readonly bookingSettings: BookingSettingsService,
    private readonly bookingEvents: BookingEventsService,
  ) {}

  /**
   * One salon's booking settings with the effective values resolved, so the admin UI can
   * show "60 دقیقه" vs "30 دقیقه (پیش‌فرض سراسری)" without re-implementing the
   * inherit-unless-overridden rule client-side.
   */
  @Get('salons/:id/booking-settings')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const salon = await this.salons.findOneBy({ id });
    if (!salon) throw new NotFoundException('Salon not found');
    const effective = await this.bookingSettings.resolveFor(salon);
    return {
      salonId: salon.id,
      // Read-only here: the OWNER controls this, and surfacing it lets an admin see why
      // a salon's requests behave the way they do without being able to override it.
      bookingConfirmationMode: salon.bookingConfirmationMode,
      // The RAW override columns, kept under distinct names from the resolved values in
      // `effective` -- spreading both under one name would make "explicitly overridden to
      // 30" indistinguishable from "inheriting the global 30", which is precisely the
      // distinction the admin screen exists to show.
      approvalTimeoutOverride: salon.approvalTimeoutMinutes,
      paymentTimeoutOverride: salon.paymentTimeoutMinutes,
      ...effective,
    };
  }

  @Patch('salons/:id/booking-settings')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('booking-settings.update', 'salon')
  async update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalonBookingSettingsDto,
  ) {
    const salon = await this.salons.findOneBy({ id });
    if (!salon) throw new NotFoundException('Salon not found');

    req.auditBefore = {
      approvalTimeoutMinutes: salon.approvalTimeoutMinutes,
      paymentTimeoutMinutes: salon.paymentTimeoutMinutes,
    };

    // `undefined` means "not supplied, leave alone"; an explicit `null` means "clear the
    // override, inherit the global default" -- so the two cannot be collapsed here.
    const patch: Partial<Salon> = {};
    if (dto.approvalTimeoutMinutes !== undefined) patch.approvalTimeoutMinutes = dto.approvalTimeoutMinutes;
    if (dto.paymentTimeoutMinutes !== undefined) patch.paymentTimeoutMinutes = dto.paymentTimeoutMinutes;
    if (Object.keys(patch).length > 0) await this.salons.update({ id }, patch);

    const updated = await this.salons.findOneBy({ id });
    req.auditAfter = {
      approvalTimeoutMinutes: updated!.approvalTimeoutMinutes,
      paymentTimeoutMinutes: updated!.paymentTimeoutMinutes,
    };

    const effective = await this.bookingSettings.resolveFor(updated!);
    return {
      salonId: updated!.id,
      bookingConfirmationMode: updated!.bookingConfirmationMode,
      approvalTimeoutOverride: updated!.approvalTimeoutMinutes,
      paymentTimeoutOverride: updated!.paymentTimeoutMinutes,
      ...effective,
    };
  }

  /**
   * The support timeline: everything that ever happened to one booking, oldest first.
   * Read-only and admin-scoped -- it can span any salon's bookings, which is exactly why
   * it doesn't live behind SalonOwnerGuard.
   */
  @Get('bookings/:id/events')
  listEvents(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookingEvents.listForBooking(id);
  }
}
