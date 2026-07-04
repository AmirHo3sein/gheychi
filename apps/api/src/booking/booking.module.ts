import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalonsModule } from '../salons/salons.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { Booking } from './booking.entity';
import { Payment } from './payment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Payment]),
    SalonsModule,
  ],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
})
export class BookingModule {}
