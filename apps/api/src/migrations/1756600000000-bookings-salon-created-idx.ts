import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The provider dashboard (GET /salons/mine/dashboard-summary) now runs several aggregates
 * over `bookings WHERE salon_id = ? AND created_at >= ? AND created_at < ?` -- twice per
 * request, since every figure is reported against the previous period as well.
 *
 * `bookings` had no index whose leading columns match that: the closest is
 * `bookings_salon_time_idx (salon_id, starts_at, ends_at)`, which narrows to the salon but
 * then has to filter every one of its rows on `created_at`. That is fine at today's volumes
 * and would degrade quietly as a busy salon's history grows -- exactly the shape
 * `financial_transactions_salon_created_idx (salon_id, created_at)` already exists for on
 * the ledger side, so this brings the bookings table to parity with it.
 */
export class BookingsSalonCreatedIdx1756600000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE INDEX bookings_salon_created_idx ON bookings (salon_id, created_at)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX bookings_salon_created_idx`);
  }
}
