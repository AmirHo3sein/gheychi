import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { SalonsModule } from '../salons/salons.module';
import { AdminCouponsController } from './admin-coupons.controller';
import { CouponRedemption } from './coupon-redemption.entity';
import { Coupon } from './coupon.entity';
import { CouponValidationController } from './coupon-validation.controller';
import { CouponsService } from './coupons.service';
import { SalonCouponsController } from './salon-coupons.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Coupon, CouponRedemption]),
    // SalonsModule re-exports TypeOrmModule (its own forFeature, which includes
    // SalonService/Salon), plus SalonsService and SalonOwnerGuard -- reused here
    // rather than re-declaring those repositories/providers.
    SalonsModule,
    AuthModule,
    AuditModule,
    PlatformConfigModule,
  ],
  controllers: [SalonCouponsController, AdminCouponsController, CouponValidationController],
  providers: [CouponsService],
  exports: [CouponsService, TypeOrmModule],
})
export class CouponsModule {}
