import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PlatformConfigModule } from '../platform-config/platform-config.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [AnalyticsModule, PlatformConfigModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
