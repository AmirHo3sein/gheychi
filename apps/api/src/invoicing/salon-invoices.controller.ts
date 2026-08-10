import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { InvoicingService } from './invoicing.service';

// Read-only for providers -- monthly settlement history, no interaction. Mirrors
// SalonEarningsController's shape exactly.
@Controller('salons/mine/invoices')
@UseGuards(SalonOwnerGuard)
export class SalonInvoicesController {
  constructor(private readonly invoicing: InvoicingService) {}

  @Get()
  list(@Req() req: Request) {
    return this.invoicing.listForSalon(req.salonId!);
  }
}
