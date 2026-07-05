import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminSalonsController } from './admin-salons.controller';
import { PublicSalonContentController } from './public-salon-content.controller';
import { SalonOwnerGuard } from './salon-owner.guard';
import { SalonPhoto } from './salon-photo.entity';
import { SalonService } from './salon-service.entity';
import { Salon } from './salon.entity';
import { SalonServicesController } from './salon-services.controller';
import { SalonsController } from './salons.controller';
import { SalonsService } from './salons.service';
import { ScheduleController } from './schedule.controller';
import { ScheduleException } from './schedule-exception.entity';
import { WorkingHour } from './working-hour.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Salon, SalonService, WorkingHour, ScheduleException, SalonPhoto]),
    AuthModule,
  ],
  controllers: [
    SalonServicesController,
    ScheduleController,
    SalonsController,
    AdminSalonsController,
    PublicSalonContentController,
  ],
  providers: [SalonsService, SalonOwnerGuard],
  exports: [SalonsService, SalonOwnerGuard, TypeOrmModule],
})
export class SalonsModule {}
