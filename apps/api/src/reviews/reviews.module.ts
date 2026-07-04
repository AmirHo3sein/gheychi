import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Booking } from '../booking/booking.entity';
import { Review } from './review.entity';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { SalonReviewsController } from './salon-reviews.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Review, Booking]), AuthModule],
  controllers: [ReviewsController, SalonReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
