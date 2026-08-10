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
