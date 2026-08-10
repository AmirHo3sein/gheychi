import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { MetricsService } from './metrics.service';

// The official Prometheus text-exposition-format content type (prom-client's own
// Registry#contentType returns this exact string) -- hardcoded rather than read off
// a Registry instance because @Header's second argument is evaluated at decorator time
// (class-definition time), before any instance exists.
const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

@Controller()
@Public()
export class MetricsController {
  // Named metricsService (not `metrics`) purely to avoid colliding with the `metrics()`
  // route handler below -- a class can't have two members with the same name.
  constructor(private readonly metricsService: MetricsService) {}

  // PUBLIC: Prometheus scrapers pull this with no session at all -- see
  // route-guard-audit.spec.ts's PUBLIC_ROUTES allowlist for this exact route and why
  // that's a deliberate, reviewed security decision (docs/phase1-audit.md section 1).
  @Get('metrics')
  @Header('Content-Type', PROMETHEUS_CONTENT_TYPE)
  metrics(): Promise<string> {
    return this.metricsService.registry.metrics();
  }
}
