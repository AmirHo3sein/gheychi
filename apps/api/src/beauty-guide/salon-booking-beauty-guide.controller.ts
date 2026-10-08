import { Controller, Get, Param, ParseUUIDPipe, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { setPrivateImageHeaders } from './beauty-guides.controller';
import { BeautyGuidesService } from './beauty-guides.service';

/**
 * The salon's read-only window onto a customer's Beauty Guide: only through a booking AT
 * THIS SALON that the customer attached the guide to. Any other booking, salon or guide is
 * a 404 -- a salon can never browse customers' guides.
 */
@Controller('salons/mine/bookings/:bookingId/beauty-guide')
@UseGuards(SalonOwnerGuard)
export class SalonBookingBeautyGuideController {
  constructor(private readonly guides: BeautyGuidesService) {}

  @Get()
  async get(@Req() req: Request, @Param('bookingId', ParseUUIDPipe) bookingId: string) {
    const { guide } = await this.guides.getForSalonBooking(req.salonId!, bookingId);
    return guide;
  }

  @Get('image')
  async image(@Req() req: Request, @Param('bookingId', ParseUUIDPipe) bookingId: string, @Res({ passthrough: true }) res: Response) {
    const bytes = await this.guides.getImageForSalonBooking(req.salonId!, bookingId);
    setPrivateImageHeaders(res);
    return new StreamableFile(bytes, { type: 'image/jpeg' });
  }
}
