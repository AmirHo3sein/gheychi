import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SalonOwnerGuard } from '../salons/salon-owner.guard';
import { SubscriptionBillingService } from './subscription-billing.service';

// Read-only for the owner -- matches SalonMineSubscriptionController's own "owner reads,
// admin manages" split (see 30-subscription-plan-foundation.md); no route here lets an
// owner create or resolve a billing period themselves.
@Controller('salons/mine/subscription/billing-periods')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonBillingPeriodsController {
  constructor(private readonly billing: SubscriptionBillingService) {}

  @Get()
  list(@Req() req: Request) {
    return this.billing.listForSalon(req.salonId!);
  }
}
