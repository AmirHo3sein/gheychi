import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CitiesController } from './cities.controller';
import { City } from './city.entity';
import { CitiesService } from './cities.service';

@Module({
  imports: [TypeOrmModule.forFeature([City])],
  controllers: [CitiesController],
  providers: [CitiesService],
  // SalonsService resolves a salon's cityId from its free-text city name -- see
  // salons.module.ts, which imports CitiesModule for exactly this.
  exports: [CitiesService],
})
export class CitiesModule {}
