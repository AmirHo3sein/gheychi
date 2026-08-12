import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminNotificationsModule } from './admin-notifications/admin-notifications.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { BookingModule } from './booking/booking.module';
import { CatalogModule } from './catalog/catalog.module';
import { CitiesModule } from './cities/cities.module';
import { CommonModule } from './common/common.module';
import { ContentModule } from './content/content.module';
import { CouponsModule } from './coupons/coupons.module';
import { ErrorTrackingModule } from './error-tracking/error-tracking.module';
import { GlobalExceptionFilter } from './error-tracking/global-exception.filter';
import { FavoritesModule } from './favorites/favorites.module';
import { HealthController } from './health/health.controller';
import { InvoicingModule } from './invoicing/invoicing.module';
import { MetricsModule } from './metrics/metrics.module';
import { PlatformConfigModule } from './platform-config/platform-config.module';
import { PushModule } from './push/push.module';
import { RedisModule } from './redis/redis.module';
import { ReferralsModule } from './referrals/referrals.module';
import { ReportsModule } from './reports/reports.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SalonsModule } from './salons/salons.module';
import { SearchModule } from './search/search.module';
import { StorageModule } from './storage/storage.module';
import { VersionModule } from './version/version.module';
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
    MetricsModule,
    ErrorTrackingModule,
    VersionModule,
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
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    // Runs on every route by default now (see auth.guard.ts) -- a route opts out with
    // @Public() instead of every protected route needing an explicit @UseGuards(AuthGuard).
    // Resolvable here because AuthModule (imported below) exports UsersModule, and
    // JwtModule is registered `global: true` inside AuthModule.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
