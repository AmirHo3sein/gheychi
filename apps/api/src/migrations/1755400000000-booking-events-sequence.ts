import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives `booking_events` a real total order.
 *
 * `created_at DEFAULT now()` is not one. In Postgres `now()` is the TRANSACTION start
 * time, so every event written inside a single transaction shares an identical timestamp
 * — and several transitions legitimately write two at once (BOOKING_CREATED +
 * APPROVAL_REQUESTED on a manual request; PAYMENT_EXPIRED + SLOT_RELEASED in the expiry
 * jobs). `ORDER BY created_at` then returns them in an arbitrary order, so the support
 * timeline could show a request being approved before it was created. This was caught by
 * an intermittently-failing timeline test, not in review.
 *
 * `clock_timestamp()` would fix the transaction-time half but not the resolution half
 * (TypeORM stamps `@CreateDateColumn` from JS, at millisecond precision, and two inserts
 * microseconds apart routinely land in the same millisecond). A monotonic sequence is the
 * only thing that is ordered by construction, so ordering reads from it instead.
 *
 * `created_at` is kept and still displayed — it is what a human wants to see; `seq` is
 * purely how rows are sorted.
 */
export class BookingEventsSequence1755400000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // bigserial assigns existing rows in physical order, which for an append-only table
    // never updated in place is their insertion order.
    await q.query(`ALTER TABLE booking_events ADD COLUMN seq bigserial NOT NULL`);
    // Replaces the (booking_id, created_at) index: every read of this table is "one
    // booking's timeline in order", and that order is now seq.
    await q.query(`DROP INDEX booking_events_booking_idx`);
    await q.query(`CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, seq)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX booking_events_booking_idx`);
    await q.query(`CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, created_at)`);
    await q.query(`ALTER TABLE booking_events DROP COLUMN seq`);
  }
}
