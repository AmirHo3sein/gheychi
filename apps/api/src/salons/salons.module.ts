import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { WorkerRating } from '../reviews/worker-rating.entity';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { AdminSalonsController } from './admin-salons.controller';
import { AdminShowcaseController } from './admin-showcase.controller';
import { PortfolioItem } from './portfolio-item.entity';
import { PublicSalonContentController } from './public-salon-content.controller';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonPhoto } from './salon-photo.entity';
import { SalonPhotosController } from './salon-photos.controller';
import { SalonPortfolioController } from './salon-portfolio.controller';
import { SalonService } from './salon-service.entity';
import { SalonStoriesController } from './salon-stories.controller';
import { SalonStory } from './salon-story.entity';
import { Salon } from './salon.entity';
import { SalonServicesController } from './salon-services.controller';
import { SalonWorkersController } from './salon-workers.controller';
import { SalonsController } from './salons.controller';
import { SalonsService } from './salons.service';
import { ScheduleController } from './schedule.controller';
import { ScheduleException } from './schedule-exception.entity';
import { SitemapSalonsController } from './sitemap-salons.controller';
import { StoryCleanupJob } from './story-cleanup.job';
import { Worker } from './worker.entity';
import { WorkingHour } from './working-hour.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Salon, SalonService, WorkingHour, ScheduleException, SalonPhoto, SalonStory, PortfolioItem, Worker,
      // WorkerRating is "owned" by ReviewsModule (created/recomputed inside
      // ReviewsService.create()) but is registered here too, purely for
      // PublicSalonContentController's read-only ratings sub-resource -- ReviewsModule
      // already imports SalonsModule, so importing ReviewsModule back here would be
      // circular. Same precedent as Review being registered in both ReviewsModule and
      // ReportsModule.
      WorkerRating,
    ]),
    AuthModule,
    StorageModule,
    AuditModule,
    AdminNotificationsModule,
    UsersModule,
    // For SalonWorkersController's GET :id/referral-code -- ReferralsModule does NOT
    // import SalonsModule back (it registers Salon/Worker directly, see the comment
    // in referrals.module.ts), so this is a plain one-directional import, no cycle.
    ReferralsModule,
  ],
  controllers: [
    SalonServicesController,
    ScheduleController,
    SalonPhotosController,
    SalonStoriesController,
    SalonPortfolioController,
    SalonWorkersController,
    SalonsController,
    AdminSalonsController,
    AdminShowcaseController,
    SitemapSalonsController,
    // PublicSalonContentController owns wildcard routes shaped `salons/:slug/...` (e.g. services, hours).
    // NestJS/Express matches routes in registration order, not by specificity, so it MUST stay registered
    // after any controller with a literal `salons/mine/...`-shaped route of the same depth (currently
    // SalonServicesController, ScheduleController, SalonPhotosController, SalonStoriesController,
    // SalonPortfolioController, SalonWorkersController) or it will silently shadow them.
    PublicSalonContentController,
  ],
  providers: [SalonsService, SalonOwnerGuard, StoryCleanupJob],
  exports: [SalonsService, SalonOwnerGuard, TypeOrmModule],
})
export class SalonsModule {}
