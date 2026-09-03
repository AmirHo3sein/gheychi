import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import { AnalyticsEventRecord } from './analytics-event.entity';
import { ANALYTICS_PROVIDER } from './analytics.provider';
import { AnalyticsService } from './analytics.service';
import { ConsoleAnalyticsProvider } from './console-analytics.provider';
import { PostgresAnalyticsProvider } from './postgres-analytics.provider';
import { SalonProfileViewInterceptor } from './salon-profile-view.interceptor';

// PostgresAnalyticsProvider is now the real default, persisting every tracked event to
// `analytics_events` (see migrations/1754900000000-analytics-events.ts) -- the same
// interface/token/factory-picks-the-implementation shape SmsModule/PushModule already
// use for SMS_PROVIDER/PUSH_PROVIDER (see CLAUDE.md's "External service abstractions"
// table), except here there's no external vendor credential to be missing: Postgres is
// already this app's own primary datastore (DB_HOST/etc. are already required just to
// boot at all), so unlike Kavenegar/WebPush there's no reason to keep Console as the
// fallback default. ANALYTICS_PROVIDER=console still opts back into the old log-only
// behavior (e.g. for a throwaway local run that shouldn't write rows) --
// ConsoleAnalyticsProvider is kept around for exactly that, not deleted.
@Module({
  imports: [TypeOrmModule.forFeature([AnalyticsEventRecord])],
  controllers: [AdminAnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsAggregationService,
    {
      provide: ANALYTICS_PROVIDER,
      inject: [ConfigService, getRepositoryToken(AnalyticsEventRecord)],
      useFactory: (config: ConfigService, events: Repository<AnalyticsEventRecord>) =>
        config.get('ANALYTICS_PROVIDER', 'postgres') === 'console'
          ? new ConsoleAnalyticsProvider()
          : new PostgresAnalyticsProvider(events),
    },
    // Registered from this module rather than main.ts so the whole
    // "salon_profile_viewed is a funnel stage" concern lives in one place -- Nest applies
    // an APP_INTERCEPTOR provider globally no matter which imported module declares it.
    // See the interceptor's own doc comment for why the emit isn't in SalonsController.
    { provide: APP_INTERCEPTOR, useClass: SalonProfileViewInterceptor },
  ],
  // AnalyticsAggregationService is exported for CrmModule's GET /salons/mine/funnel; the
  // admin-side summary consumes it through this module's own controller.
  exports: [AnalyticsService, AnalyticsAggregationService],
})
export class AnalyticsModule {}
