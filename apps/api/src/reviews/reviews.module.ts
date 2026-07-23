import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminReviewsController } from './admin-reviews.controller';
import { AdminWorkerRatingsController } from './admin-worker-ratings.controller';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { Booking } from '../booking/booking.entity';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { SalonsModule } from '../salons/salons.module';
import { Review } from './review.entity';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { SalonReviewReplyController } from './salon-review-reply.controller';
import { SalonReviewsController } from './salon-reviews.controller';
import { WorkerRating } from './worker-rating.entity';

@Module({
  imports: [
    // Worker is "owned" by SalonsModule's forFeature registration and reaches this
    // module via SalonsModule's TypeOrmModule export (same cross-module pattern
    // BookingModule already relies on for Salon/SalonService -- see bookings.service.ts).
    TypeOrmModule.forFeature([Review, Booking, WorkerRating]),
    AuthModule,
    SalonsModule,
    AuditModule,
    PlatformConfigModule,
  ],
  controllers: [
    ReviewsController,
    SalonReviewsController,
    SalonReviewReplyController,
    AdminReviewsController,
    AdminWorkerRatingsController,
  ],
  providers: [ReviewsService],
})
export class ReviewsModule {}
