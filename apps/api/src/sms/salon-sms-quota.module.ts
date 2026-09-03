import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalonSmsMessage } from '../crm/salon-sms-message.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { SalonSmsQuotaService } from './salon-sms-quota.service';

/**
 * Deliberately its own module rather than a provider inside SmsModule.
 *
 * The quota needs the entitlement engine, and SubscriptionsModule imports AuthModule, which
 * imports SmsModule for OTP delivery -- so putting this inside SmsModule closes the cycle
 * SmsModule -> SubscriptionsModule -> AuthModule -> SmsModule and Nest refuses to build the
 * graph. Splitting it out breaks the cycle without a forwardRef, and is honest about the
 * dependency anyway: this service never sends anything. It meters and records, and the
 * caller passes in the send as a closure, so it has no need of SMS_PROVIDER at all.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SalonSmsMessage]), SubscriptionsModule],
  providers: [SalonSmsQuotaService],
  exports: [SalonSmsQuotaService],
})
export class SalonSmsQuotaModule {}
