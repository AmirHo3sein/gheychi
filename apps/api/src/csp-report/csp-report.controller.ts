import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Receives browser-submitted Content-Security-Policy violation reports (the legacy
 * `report-uri` mechanism, not the newer `Report-To`/`report-to` Reporting API, which needs
 * a separate `Report-To` header and reporting-group setup this codebase doesn't have --
 * `report-uri` remains functional in every browser this policy needs to support, and is
 * what docs/deployment/csp-proposal.md's point 5 recommends). Wired up as the collector for
 * the Content-Security-Policy-Report-Only header applied in the Caddyfile.
 *
 * @Public(): any browser on the internet can be made to send one of these, with no session
 * -- there is no meaningful "authorized caller" concept for a violation report. The body
 * shape is entirely browser-controlled and varies slightly by browser, so this deliberately
 * does NOT run it through a class-validator DTO (whitelist/transform would either silently
 * drop fields a stricter shape didn't anticipate, or reject the whole report outright on a
 * mismatch) -- the raw body is logged wholesale for triage, and only the one bounded label
 * value read out of it ever reaches a metric (see MetricsService.observeCspViolation, which
 * normalizes it against a fixed allowlist before it becomes a Prometheus label).
 */
@Controller()
@Public()
export class CspReportController {
  private readonly logger = new Logger(CspReportController.name);

  constructor(private readonly metrics: MetricsService) {}

  @Post('csp-report')
  @HttpCode(204)
  report(@Body() body: unknown): void {
    const violation = this.extractViolation(body);
    this.logger.warn(`CSP violation report: ${JSON.stringify(violation ?? body)}`);
    const directive =
      (violation?.['violated-directive'] as string | undefined) ??
      (violation?.['effective-directive'] as string | undefined) ??
      'unknown';
    this.metrics.observeCspViolation(directive);
  }

  private extractViolation(body: unknown): Record<string, unknown> | undefined {
    if (body && typeof body === 'object' && 'csp-report' in body) {
      const inner = (body as Record<string, unknown>)['csp-report'];
      if (inner && typeof inner === 'object') {
        return inner as Record<string, unknown>;
      }
    }
    return undefined;
  }
}
