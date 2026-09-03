import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsEventRecord } from './analytics-event.entity';

const DEFAULT_RANGE_MS = 30 * 24 * 60 * 60 * 1000;

// The actual booking funnel, in funnel order -- the three events a real
// conversion-rate-over-time view needs (see bookings.service.ts/payments.service.ts for
// where each is fired). Deliberately not "every event_name that exists": this endpoint is
// explicitly not a general-purpose analytics query engine.
const FUNNEL_EVENTS = ['booking_started', 'booking_confirmed', 'payment_succeeded'] as const;
type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/**
 * The per-SALON funnel, in funnel order. Deliberately NOT the same list as FUNNEL_EVENTS
 * above: a stage only belongs here if its event actually carries a `salonId` in its
 * properties, because that is what `PostgresAnalyticsProvider` lifts into the indexed
 * `analytics_events.salon_id` column this query filters on.
 *
 * `payment_succeeded` sits between them and carries `salonId` as of 2026-09-03 (its emit
 * site in `booking/payments.service.ts` looks the booking up to attach it). Rows written
 * BEFORE that date have `salon_id = NULL` and are invisible here -- deliberately, since no
 * backfill can invent which salon an old row belonged to; the stage's counts are therefore
 * honest only for windows starting after that date, and read as zero for earlier ones.
 *
 * `salon_profile_viewed` is emitted by `salon-profile-view.interceptor.ts` in this module.
 */
export const SALON_FUNNEL_STAGES = [
  'salon_profile_viewed',
  'booking_started',
  'payment_succeeded',
  'booking_confirmed',
] as const;
export type SalonFunnelStage = (typeof SALON_FUNNEL_STAGES)[number];

export interface SalonFunnelStageCount {
  stage: SalonFunnelStage;
  count: number;
  /**
   * Share of the PREVIOUS stage that reached this one. `null` -- never 0, never an
   * interpolated figure -- for the first stage and for any stage whose predecessor has no
   * events at all in the window, because "0% converted" and "we have no data" are
   * different statements and only one of them is true.
   */
  conversionFromPreviousPercent: number | null;
}

export interface SalonFunnel {
  from: string;
  to: string;
  stages: SalonFunnelStageCount[];
}

export interface AdminAnalyticsSummaryQuery {
  from?: string;
  to?: string;
}

export interface AnalyticsEventTotal {
  eventName: string;
  count: number;
}

export type FunnelDayCounts = { date: string } & Record<FunnelEvent, number>;

export interface AnalyticsSummary {
  from: string;
  to: string;
  totalsByEvent: AnalyticsEventTotal[];
  funnelByDay: FunnelDayCounts[];
}

/**
 * Read side of the new `analytics_events` table -- backs `GET /admin/analytics/summary`
 * (see `admin-analytics.controller.ts`). Two simple `GROUP BY` queries, exactly as scoped:
 * a total count per `event_name` over the range, and a day-by-day count of the three
 * booking-funnel events. Not a general-purpose query engine -- just enough real structured
 * data for a follow-up dashboard's conversion-rate-over-time view.
 */
@Injectable()
export class AnalyticsAggregationService {
  constructor(@InjectRepository(AnalyticsEventRecord) private readonly events: Repository<AnalyticsEventRecord>) {}

  async summary(query: AdminAnalyticsSummaryQuery): Promise<AnalyticsSummary> {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - DEFAULT_RANGE_MS);

    const [totalsRaw, funnelRaw] = await Promise.all([
      this.events
        .createQueryBuilder('e')
        .select('e.eventName', 'eventName')
        .addSelect('COUNT(*)', 'count')
        .where('e.createdAt BETWEEN :from AND :to', { from, to })
        .groupBy('e.eventName')
        .orderBy('e.eventName', 'ASC')
        .getRawMany<{ eventName: string; count: string }>(),
      this.events
        .createQueryBuilder('e')
        .select("date_trunc('day', e.createdAt)", 'day')
        .addSelect('e.eventName', 'eventName')
        .addSelect('COUNT(*)', 'count')
        .where('e.createdAt BETWEEN :from AND :to', { from, to })
        .andWhere('e.eventName IN (:...names)', { names: FUNNEL_EVENTS })
        .groupBy("date_trunc('day', e.createdAt)")
        .addGroupBy('e.eventName')
        .orderBy('day', 'ASC')
        .getRawMany<{ day: Date; eventName: FunnelEvent; count: string }>(),
    ]);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totalsByEvent: totalsRaw.map((row) => ({ eventName: row.eventName, count: Number(row.count) })),
      funnelByDay: this.pivotFunnel(funnelRaw),
    };
  }

  /**
   * One salon's funnel over a window, backing `GET /api/salons/mine/funnel`.
   *
   * Salon isolation is the query shape itself -- `WHERE e.salonId = :salonId` -- exactly
   * like every other provider-scoped read in this codebase (CrmService's own queries,
   * BookingsService.getEarnings). There is no separate ownership branch to forget, and the
   * caller's salonId always comes from SalonOwnerGuard, never from the request body.
   *
   * A stage with no rows returns `count: 0`, which is honest: the event IS emitted for this
   * stage platform-wide, so zero really does mean "this didn't happen here in this window".
   * That is a different claim from a stage we cannot measure at all, which is handled by
   * simply not being in SALON_FUNNEL_STAGES.
   */
  async salonFunnel(salonId: string, from: Date, to: Date): Promise<SalonFunnel> {
    const rows = await this.events
      .createQueryBuilder('e')
      .select('e.eventName', 'eventName')
      .addSelect('COUNT(*)', 'count')
      .where('e.salonId = :salonId', { salonId })
      .andWhere('e.createdAt BETWEEN :from AND :to', { from, to })
      .andWhere('e.eventName IN (:...names)', { names: SALON_FUNNEL_STAGES })
      .groupBy('e.eventName')
      .getRawMany<{ eventName: SalonFunnelStage; count: string }>();

    const counts = new Map(rows.map((row) => [row.eventName, Number(row.count)]));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      stages: SALON_FUNNEL_STAGES.map((stage, index) => {
        const count = counts.get(stage) ?? 0;
        const previousCount = index === 0 ? null : (counts.get(SALON_FUNNEL_STAGES[index - 1]!) ?? 0);
        return {
          stage,
          count,
          conversionFromPreviousPercent:
            previousCount === null || previousCount === 0 ? null : Math.round((count / previousCount) * 100),
        };
      }),
    };
  }

  // Pivots (day, eventName, count) rows into one row per day with a column per funnel
  // event -- the shape a conversion-rate chart wants directly, rather than making the
  // dashboard do its own pivot. Only days with at least one funnel event appear (no
  // zero-filling of entirely-empty days) -- keeping this query simple, per spec; a
  // follow-up dashboard can zero-fill client-side against the date range it already knows.
  private pivotFunnel(rows: { day: Date; eventName: FunnelEvent; count: string }[]): FunnelDayCounts[] {
    const byDay = new Map<string, FunnelDayCounts>();
    for (const row of rows) {
      const date = row.day.toISOString().slice(0, 10);
      let entry = byDay.get(date);
      if (!entry) {
        entry = { date, booking_started: 0, booking_confirmed: 0, payment_succeeded: 0 };
        byDay.set(date, entry);
      }
      entry[row.eventName] = Number(row.count);
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
}
