import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { SalonService } from './salon-service.entity';
import { Salon } from './salon.entity';
import { SalonServicesController } from './salon-services.controller';
import { SalonsController } from './salons.controller';
import { SalonsService } from './salons.service';

@Module({
  imports: [TypeOrmModule.forFeature([Salon, SalonService]), AuthModule],
  controllers: [SalonServicesController, SalonsController],
  providers: [SalonsService],
  exports: [SalonsService, TypeOrmModule],
})
export class SalonsModule {}
