import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { SalonsModule } from '../salons/salons.module';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { Booking } from './booking.entity';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { MockPaymentGateway } from './mock-payment.gateway';
import { PAYMENT_GATEWAY } from './payment-gateway';
import { Payment } from './payment.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { SalonBookingsController } from './salon-bookings.controller';
import { ZarinpalGateway } from './zarinpal-payment.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Payment]),
    SalonsModule,
    PlatformConfigModule,
    AuthModule,
    SmsModule,
    UsersModule,
  ],
  controllers: [AvailabilityController, BookingsController, PaymentsController, SalonBookingsController],
  providers: [
    AvailabilityService,
    BookingsService,
    PaymentsService,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('PAYMENT_GATEWAY') === 'zarinpal'
          ? new ZarinpalGateway(config.getOrThrow('ZARINPAL_MERCHANT_ID'))
          : new MockPaymentGateway(),
    },
  ],
})
export class BookingModule {}
