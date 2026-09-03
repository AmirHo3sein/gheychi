import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AlertsModule } from '../alerts/alerts.module';
import { AuditModule } from '../audit/audit.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { CouponsModule } from '../coupons/coupons.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { PushModule } from '../push/push.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { SalonsModule } from '../salons/salons.module';
import { SalonSmsQuotaModule } from '../sms/salon-sms-quota.module';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { AdminBookingSettingsController } from './admin-booking-settings.controller';
import { AdminBookingsController } from './admin-bookings.controller';
import { AdminBookingsService } from './admin-bookings.service';
import { Booking } from './booking.entity';
import { BookingApprovalExpiryJob } from './booking-approval-expiry.job';
import { BookingEvent } from './booking-event.entity';
import { BookingEventsService } from './booking-events.service';
import { BookingExpiryJob } from './booking-expiry.job';
import { BookingSettingsService } from './booking-settings.service';
import { BookingReminderJob } from './booking-reminder.job';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { MockPaymentGateway } from './mock-payment.gateway';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Payment } from './payment.entity';
import { PaymentReconciliationJob } from './payment-reconciliation.job';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ReferralExpiryJob } from './referral-expiry.job';
import { ReferralGrantJob } from './referral-grant.job';
import { RefundRetryJob } from './refund-retry.job';
import { SalonBookingsController } from './salon-bookings.controller';
import { SalonEarningsController } from './salon-earnings.controller';
import { ZarinpalGateway } from './zarinpal-payment.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Payment, BookingEvent]),
    SalonsModule,
    CouponsModule,
    PlatformConfigModule,
    AlertsModule,
    AnalyticsModule,
    AuthModule,
    SmsModule,
    SalonSmsQuotaModule,
    PushModule,
    UsersModule,
    // ReferralsModule has no dependency back on BookingModule (its tryGrantReward/
    // reverseIfNeeded read payments/bookings via raw SQL, not TypeORM entities) --
    // this is a plain one-directional import, no forwardRef needed.
    ReferralsModule,
    // For WalletService, injected into BookingsService (applying wallet balance to a
    // deposit) and every job/service that calls releaseBookingHold. Same one-directional
    // shape as ReferralsModule above -- WalletModule has no dependency back on this module.
    WalletModule,
    // For InvoicingService.recordCommission(), called inside updateStatus's own
    // transaction when a booking reaches completed/no_show. Same one-directional shape
    // as the two imports above.
    InvoicingModule,
    // For the AuditInterceptor on the admin booking-settings route.
    AuditModule,
  ],
  controllers: [
    AdminBookingSettingsController,
    AdminBookingsController,
    AvailabilityController,
    BookingsController,
    PaymentsController,
    SalonBookingsController,
    SalonEarningsController,
  ],
  providers: [
    AdminBookingsService,
    AvailabilityService,
    BookingEventsService,
    BookingSettingsService,
    BookingsService,
    PaymentsService,
    BookingApprovalExpiryJob,
    BookingExpiryJob,
    BookingReminderJob,
    PaymentReconciliationJob,
    RefundRetryJob,
    ReferralGrantJob,
    ReferralExpiryJob,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('PAYMENT_GATEWAY') === 'zarinpal'
          ? new ZarinpalGateway(config.getOrThrow('ZARINPAL_MERCHANT_ID'), config.getOrThrow('ZARINPAL_ACCESS_TOKEN'))
          : new MockPaymentGateway(),
    },
  ],
})
export class BookingModule {}
