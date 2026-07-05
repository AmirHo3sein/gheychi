import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Salon } from '../salons/salon.entity';
import { Favorite } from './favorite.entity';
import { FavoritesController } from './favorites.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Favorite, Salon]), AuthModule],
  controllers: [FavoritesController],
})
export class FavoritesModule {}
