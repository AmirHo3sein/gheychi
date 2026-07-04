import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminReviewsController } from './admin-reviews.controller';
import { AuthModule } from '../auth/auth.module';
import { Booking } from '../booking/booking.entity';
import { SalonsModule } from '../salons/salons.module';
import { Review } from './review.entity';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { SalonReviewReplyController } from './salon-review-reply.controller';
import { SalonReviewsController } from './salon-reviews.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Review, Booking]), AuthModule, SalonsModule],
  controllers: [ReviewsController, SalonReviewsController, SalonReviewReplyController, AdminReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
