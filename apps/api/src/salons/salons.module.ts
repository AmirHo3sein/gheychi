import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Salon } from './salon.entity';
import { SalonsController } from './salons.controller';
import { SalonsService } from './salons.service';

@Module({
  imports: [TypeOrmModule.forFeature([Salon]), AuthModule],
  controllers: [SalonsController],
  providers: [SalonsService],
  exports: [SalonsService, TypeOrmModule],
})
export class SalonsModule {}
