import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotificationsModule } from './admin-notifications/admin-notifications.module';
import { AuthModule } from './auth/auth.module';
import { BookingModule } from './booking/booking.module';
import { CatalogModule } from './catalog/catalog.module';
import { FavoritesModule } from './favorites/favorites.module';
import { HealthController } from './health/health.controller';
import { PlatformConfigModule } from './platform-config/platform-config.module';
import { PushModule } from './push/push.module';
import { RedisModule } from './redis/redis.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SalonsModule } from './salons/salons.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow('DB_HOST'),
        port: +config.get('DB_PORT', 5432),
        username: config.getOrThrow('DB_USER'),
        password: config.getOrThrow('DB_PASS'),
        database: config.getOrThrow('DB_NAME'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    PlatformConfigModule,
    AuthModule,
    CatalogModule,
    SalonsModule,
    BookingModule,
    SearchModule,
    ReviewsModule,
    FavoritesModule,
    PushModule,
    AdminNotificationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
