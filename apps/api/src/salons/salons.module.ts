import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
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
import { SalonsController } from './salons.controller';
import { SalonsService } from './salons.service';
import { ScheduleController } from './schedule.controller';
import { ScheduleException } from './schedule-exception.entity';
import { SitemapSalonsController } from './sitemap-salons.controller';
import { StoryCleanupJob } from './story-cleanup.job';
import { WorkingHour } from './working-hour.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Salon, SalonService, WorkingHour, ScheduleException, SalonPhoto, SalonStory, PortfolioItem,
    ]),
    AuthModule,
    StorageModule,
    AuditModule,
    AdminNotificationsModule,
  ],
  controllers: [
    SalonServicesController,
    ScheduleController,
    SalonPhotosController,
    SalonStoriesController,
    SalonPortfolioController,
    SalonsController,
    AdminSalonsController,
    AdminShowcaseController,
    SitemapSalonsController,
    // PublicSalonContentController owns wildcard routes shaped `salons/:slug/...` (e.g. services, hours).
    // NestJS/Express matches routes in registration order, not by specificity, so it MUST stay registered
    // after any controller with a literal `salons/mine/...`-shaped route of the same depth (currently
    // SalonServicesController, ScheduleController, SalonPhotosController, SalonStoriesController,
    // SalonPortfolioController) or it will silently shadow them.
    PublicSalonContentController,
  ],
  providers: [SalonsService, SalonOwnerGuard, StoryCleanupJob],
  exports: [SalonsService, SalonOwnerGuard, TypeOrmModule],
})
export class SalonsModule {}
