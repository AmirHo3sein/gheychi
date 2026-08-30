import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SalonsModule } from '../salons/salons.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AdminSubscriptionBillingController } from './admin-subscription-billing.controller';
import { AdminSubscriptionCouponsController } from './admin-subscription-coupons.controller';
import { SalonBillingPeriodsController } from './salon-billing-periods.controller';
import { SubscriptionBillingPeriod } from './subscription-billing-period.entity';
import { SubscriptionBillingService } from './subscription-billing.service';
import { SubscriptionCouponRedemption } from './subscription-coupon-redemption.entity';
import { SubscriptionCoupon } from './subscription-coupon.entity';
import { SubscriptionCouponsService } from './subscription-coupons.service';

/**
 * Phase 7 of the monetization initiative -- subscription coupons + billing-architecture
 * scaffolding (docs/technical-overview/34-subscription-coupons-and-billing.md). A genuinely
 * separate entity/module from the booking `coupons` feature -- coupon_redemptions.booking_id
 * is NOT NULL UNIQUE there, structurally a booking-redemption object a subscription-period
 * redemption doesn't fit (Phase-A discovery finding). SalonsModule is needed for
 * SalonOwnerGuard (the owner's read-only billing-history route); SubscriptionsModule is
 * needed to read a salon's current plan when creating a billing period. Neither has a
 * dependency back on this module, so both are plain one-directional imports.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SubscriptionCoupon, SubscriptionCouponRedemption, SubscriptionBillingPeriod]),
    AuthModule,
    AuditModule,
    SalonsModule,
    SubscriptionsModule,
  ],
  controllers: [AdminSubscriptionCouponsController, AdminSubscriptionBillingController, SalonBillingPeriodsController],
  providers: [SubscriptionCouponsService, SubscriptionBillingService],
})
export class BillingModule {}
