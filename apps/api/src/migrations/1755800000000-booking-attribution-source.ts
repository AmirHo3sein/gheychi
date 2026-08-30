import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 4 of the monetization initiative -- see
// docs/superpowers/specs/2026-08-30-monetization-platform-design.md. Marketing-channel
// attribution, distinct from the existing `source` column ('online'/'manual', how the row
// was created). Every existing booking backfills to NULL (no attributable channel) via the
// column default, which is exactly what they already were.
export class BookingAttributionSource1755800000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE bookings
        ADD COLUMN attribution_source varchar(20) NULL,
        ADD CONSTRAINT bookings_attribution_source_chk
          CHECK (attribution_source IN ('qr', 'direct', 'search'))
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE bookings DROP COLUMN attribution_source`);
  }
}
