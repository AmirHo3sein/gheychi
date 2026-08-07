import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotificationsModule } from './admin-notifications/admin-notifications.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { BookingModule } from './booking/booking.module';
import { CatalogModule } from './catalog/catalog.module';
import { CitiesModule } from './cities/cities.module';
import { CommonModule } from './common/common.module';
import { ContentModule } from './content/content.module';
import { CouponsModule } from './coupons/coupons.module';
import { FavoritesModule } from './favorites/favorites.module';
import { HealthController } from './health/health.controller';
import { InvoicingModule } from './invoicing/invoicing.module';
import { PlatformConfigModule } from './platform-config/platform-config.module';
import { PushModule } from './push/push.module';
import { RedisModule } from './redis/redis.module';
import { ReferralsModule } from './referrals/referrals.module';
import { ReportsModule } from './reports/reports.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SalonsModule } from './salons/salons.module';
import { SearchModule } from './search/search.module';
import { StorageModule } from './storage/storage.module';
import { WalletModule } from './wallet/wallet.module';

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
    CommonModule,
    PlatformConfigModule,
    AlertsModule,
    AuthModule,
    CatalogModule,
    CitiesModule,
    SalonsModule,
    BookingModule,
    CouponsModule,
    SearchModule,
    ReviewsModule,
    ReportsModule,
    FavoritesModule,
    PushModule,
    AdminNotificationsModule,
    ContentModule,
    WalletModule,
    ReferralsModule,
    InvoicingModule,
    StorageModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
