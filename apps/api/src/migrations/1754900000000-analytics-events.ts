import { MigrationInterface, QueryRunner } from 'typeorm';

export class AnalyticsEvents1754900000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // PostgresAnalyticsProvider's persistence target -- one row per AnalyticsService.track()
    // call, replacing ConsoleAnalyticsProvider's log-only behavior as the default. user_id is
    // ON DELETE SET NULL (not CASCADE): a historical event ("a booking_started happened on
    // this day") should survive the actor's account being deleted -- same reasoning as
    // audit_log NOT needing this (audit_log.actor_id is NOT NULL, always an admin), but here
    // userId is already optional on AnalyticsEvent (see analytics.provider.ts) since not every
    // event has a resolved actor.
    await q.query(`
      CREATE TABLE analytics_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_name varchar(100) NOT NULL,
        properties jsonb,
        user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    // Covers AnalyticsAggregationService's summary query: GROUP BY event_name plus a
    // created_at range filter/day-bucket for the booking-funnel breakdown -- same
    // composite-covers-filter-and-sort reasoning as audit_log_action_created_idx.
    await q.query(`CREATE INDEX analytics_events_event_name_created_idx ON analytics_events (event_name, created_at)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE analytics_events`);
  }
}
