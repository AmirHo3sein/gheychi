import { Module } from '@nestjs/common';
import { CspReportController } from './csp-report.controller';

// MetricsService is provided by MetricsModule, which is @Global() -- no imports needed here,
// same reasoning as backup-monitoring.module.ts's own doc comment for why it doesn't import
// MetricsModule directly.
@Module({
  controllers: [CspReportController],
})
export class CspReportModule {}
