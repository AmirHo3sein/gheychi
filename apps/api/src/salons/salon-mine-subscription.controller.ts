import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SalonOwnerGuard } from './salon-owner.guard';

// Read-only, provider-facing: the owner sees their own plan/entitlements but has no route
// to change any of it -- picking a plan, canceling, and setting overrides are all
// admin-only (see AdminSalonSubscriptionsController), matching the owner's own "salon owner
// picks only booking mode, nothing commercial" decision. Lives in SalonsModule rather than
// SubscriptionsModule specifically to reach SalonOwnerGuard without SubscriptionsModule
// importing SalonsModule back (see subscriptions.module.ts's own doc comment).
@Controller('salons/mine/subscription')
@UseGuards(AuthGuard, SalonOwnerGuard)
export class SalonMineSubscriptionController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  get(@Req() req: Request) {
    return this.subscriptions.getForSalon(req.salonId!);
  }
}
