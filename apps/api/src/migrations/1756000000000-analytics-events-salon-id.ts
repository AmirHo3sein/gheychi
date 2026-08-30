import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 5 of the monetization initiative. analytics_events had no salon_id column at all --
// PostgresAnalyticsProvider now lifts it out of `properties.salonId` (already present on
// every booking-funnel event) at write time, so per-salon funnel queries become a plain
// indexed column lookup instead of a jsonb reach-in. Nullable: most events (user_registered,
// etc.) have no salon context.
export class AnalyticsEventsSalonId1756000000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // ON DELETE SET NULL, matching user_id's own existing treatment on this table: a
    // historical event should survive the salon row being deleted, not disappear with it.
    await q.query(`ALTER TABLE analytics_events ADD COLUMN salon_id uuid NULL REFERENCES salons(id) ON DELETE SET NULL`);
    await q.query(`CREATE INDEX analytics_events_salon_idx ON analytics_events (salon_id, created_at DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX analytics_events_salon_idx`);
    await q.query(`ALTER TABLE analytics_events DROP COLUMN salon_id`);
  }
}
