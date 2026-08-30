import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsEventRecord } from './analytics-event.entity';
import { AnalyticsEvent, AnalyticsProvider } from './analytics.provider';

/**
 * The real (DB-backed) `AnalyticsProvider` -- the new default in `analytics.module.ts`,
 * replacing `ConsoleAnalyticsProvider`. Inserts one row per `track()` call into
 * `analytics_events` (see `migrations/1754900000000-analytics-events.ts`), read back by
 * `AnalyticsAggregationService` for the `GET /api/admin/analytics/summary` endpoint.
 *
 * Never throws into its caller: same "analytics failure must never break the real
 * operation" discipline every `AnalyticsService.track(...).catch(() => {})` call site
 * already assumes, and the same best-effort shape `AuditService.record` already uses for
 * its own DB-backed write (log-and-swallow, not alert -- see that method's own comment for
 * why no `AlertsService` paging exists here either).
 *
 * `requestId` (present on `AnalyticsEvent`) is deliberately NOT persisted -- the
 * `analytics_events` schema only carries what a follow-up dashboard's aggregation
 * queries need (event_name/properties/user_id/created_at); a raw per-request correlation
 * id belongs in request logs, not a product-analytics table meant to be grouped/counted.
 */
@Injectable()
export class PostgresAnalyticsProvider implements AnalyticsProvider {
  private readonly logger = new Logger('Analytics');

  constructor(@InjectRepository(AnalyticsEventRecord) private readonly events: Repository<AnalyticsEventRecord>) {}

  async track(event: AnalyticsEvent): Promise<void> {
    try {
      // Every booking-funnel event already carries a bare salonId reference in its own
      // properties (see AnalyticsService's own doc comment on that convention) -- lifted out
      // here rather than widening AnalyticsService.track()'s signature, so this stays a
      // zero-call-site-change addition.
      const salonId = typeof event.properties?.salonId === 'string' ? event.properties.salonId : null;
      await this.events.insert({
        eventName: event.name,
        // TypeORM's QueryDeepPartialEntity recurses into object-typed columns; an
        // index-signature type like Record<string, unknown> | null doesn't satisfy that
        // recursive shape structurally, so the jsonb column needs an `any` escape here --
        // same as AuditService.record's own payload insert. Runtime behavior is
        // unaffected -- the pg driver serializes it as-is.
        properties: (event.properties ?? null) as any,
        userId: event.userId ?? null,
        salonId,
        createdAt: event.timestamp,
      });
    } catch (err) {
      this.logger.error(
        `Failed to persist analytics event ${event.name}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
