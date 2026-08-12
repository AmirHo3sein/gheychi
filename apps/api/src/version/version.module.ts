import { Module } from '@nestjs/common';
import { VersionController } from './version.controller';
import { VersionService } from './version.service';

// Same shape as ErrorTrackingModule: a small, dependency-free seam with nothing else
// in the codebase needing to inject VersionService, so it's not @Global() like
// MetricsModule (which a dozen unrelated services depend on).
@Module({
  controllers: [VersionController],
  providers: [VersionService],
})
export class VersionModule {}
