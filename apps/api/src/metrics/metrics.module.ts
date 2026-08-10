import { Global, Module } from '@nestjs/common';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

// @Global(), mirroring CommonModule's own shape (see common.module.ts): MetricsService
// is a cross-cutting, dependency-free seam that a dozen unrelated services
// (bookings/payments/coupons/wallet/referrals/cron-job-runner, ...) all need to inject
// -- imported once here in AppModule, it's then available everywhere without every one
// of those modules adding an explicit MetricsModule import (which, for a couple of
// them, would risk reopening one of the module-cycle problems their own doc comments
// already describe navigating around).
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, HttpMetricsMiddleware],
  exports: [MetricsService, HttpMetricsMiddleware],
})
export class MetricsModule {}
