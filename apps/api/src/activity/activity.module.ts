import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../booking/booking.entity';
import { ReferralReward } from '../referrals/referral-reward.entity';
import { Review } from '../reviews/review.entity';
import { SalonService } from '../salons/salon-service.entity';
import { Salon } from '../salons/salon.entity';
import { Worker } from '../salons/worker.entity';
import { WalletTransaction } from '../wallet/wallet-transaction.entity';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({
  // Every entity registered directly here (not via importing BookingModule/ReviewsModule/
  // etc. back) -- this is a pure cross-domain READ aggregation with no business logic of
  // its own, so it has no need for (and no risk of opening a module cycle from) any of
  // those modules' own providers/guards/services. Same "register entities directly"
  // precedent as ReferralsModule/SalonsModule use for exactly this reason.
  imports: [TypeOrmModule.forFeature([Booking, WalletTransaction, Review, ReferralReward, Salon, SalonService, Worker])],
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
