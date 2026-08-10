import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import { AdminAnalyticsSummaryQueryDto } from './dto/admin-analytics-summary-query.dto';

// AuthGuard already runs globally (see app.module.ts) -- RolesGuard + @Roles('admin') is
// the whole guard setup needed here, same minimal shape as AdminConfigController/
// AdminAuditController.
@Controller('admin/analytics')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminAnalyticsController {
  constructor(private readonly aggregation: AnalyticsAggregationService) {}

  @Get('summary')
  summary(@Query() query: AdminAnalyticsSummaryQueryDto) {
    return this.aggregation.summary(query);
  }
}
