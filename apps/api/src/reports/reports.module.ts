import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { Booking } from '../booking/booking.entity';
import { Review } from '../reviews/review.entity';
import { PortfolioItem } from '../salons/portfolio-item.entity';
import { SalonStory } from '../salons/salon-story.entity';
import { AdminReportsController } from './admin-reports.controller';
import { Report } from './report.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Report, Review, SalonStory, PortfolioItem, Booking]),
    AuthModule,
    AuditModule,
    AdminNotificationsModule,
  ],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
