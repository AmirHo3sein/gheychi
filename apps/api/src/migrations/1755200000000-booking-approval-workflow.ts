import { MigrationInterface, QueryRunner } from 'typeorm';

export class BookingApprovalWorkflow1755200000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // --- Salon-level configuration -------------------------------------------------
    // booking_confirmation_mode is the ONLY one of these three the salon owner may
    // change (PATCH /salons/mine). The two timeout overrides are admin-only
    // (PATCH /admin/salons/:id/booking-settings) -- a provider must never be able to
    // give themselves an unbounded window to sit on a customer's request. NULL on
    // either override means "inherit the global platform_config default".
    await q.query(`
      ALTER TABLE salons
        ADD COLUMN booking_confirmation_mode varchar(20) NOT NULL DEFAULT 'automatic',
        ADD COLUMN approval_timeout_minutes int NULL,
        ADD COLUMN payment_timeout_minutes int NULL,
        ADD CONSTRAINT salons_booking_confirmation_mode_chk
          CHECK (booking_confirmation_mode IN ('automatic', 'manual_approval')),
        ADD CONSTRAINT salons_approval_timeout_chk
          CHECK (approval_timeout_minutes IS NULL OR (approval_timeout_minutes BETWEEN 1 AND 1440)),
        ADD CONSTRAINT salons_payment_timeout_chk
          CHECK (payment_timeout_minutes IS NULL OR (payment_timeout_minutes BETWEEN 1 AND 1440))
    `);

    // --- Booking-level snapshots ---------------------------------------------------
    // confirmation_mode records which workflow this booking was CREATED under, so a
    // salon flipping its mode later never retroactively changes how an in-flight
    // booking behaves. DEFAULT 'automatic' backfills every pre-existing row with
    // exactly the behaviour it already had.
    //
    // approval_expires_at / payment_expires_at are immutable per-booking deadline
    // SNAPSHOTS, deliberately not recomputed from live config at job time. The
    // pre-existing hold expiry (BookingExpiryJob) derived its cutoff from
    // `created_at < now() - booking_hold_ttl_minutes` read fresh on every tick, which
    // means an admin editing that key silently moved the deadline of every in-flight
    // hold. New rows carry their own deadline; legacy rows (NULL) keep falling back to
    // the old derivation, so this migration changes no existing booking's behaviour.
    await q.query(`
      ALTER TABLE bookings
        ADD COLUMN confirmation_mode varchar(20) NOT NULL DEFAULT 'automatic',
        ADD COLUMN approval_expires_at timestamptz NULL,
        ADD COLUMN payment_expires_at timestamptz NULL,
        ADD CONSTRAINT bookings_confirmation_mode_chk
          CHECK (confirmation_mode IN ('automatic', 'manual_approval'))
    `);

    // Partial indexes: both expiry jobs scan exactly one status at a time, and only
    // ever for rows whose deadline has passed. Indexing the whole table would be
    // mostly dead weight -- every terminal booking (the vast majority, forever) can
    // never match either predicate.
    await q.query(
      `CREATE INDEX bookings_approval_expiry_idx ON bookings (approval_expires_at) WHERE status = 'pending_approval'`,
    );
    await q.query(
      `CREATE INDEX bookings_payment_expiry_idx ON bookings (payment_expires_at) WHERE status = 'pending_payment'`,
    );

    // --- Global default ------------------------------------------------------------
    // Only ONE new key: the payment-timeout global default is the pre-existing
    // `booking_hold_ttl_minutes` (seeded 15), reused rather than duplicated -- that key
    // already IS "how long a customer has to pay", and forking it into a second key
    // would leave two sources of truth for one concept.
    await q.query(`INSERT INTO platform_config (key, value) VALUES ('booking_approval_timeout_minutes', '30')`);

    // --- Booking lifecycle event log -----------------------------------------------
    // Deliberately separate from audit_log: audit answers "which admin did what", this
    // answers "what happened to this booking", including the many transitions that have
    // no admin actor at all (customer requests, salon decisions, cron expiries).
    // ON DELETE CASCADE: an event has no meaning without its booking.
    await q.query(`
      CREATE TABLE booking_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        event_type varchar(40) NOT NULL,
        actor_type varchar(20) NOT NULL,
        actor_id uuid NULL REFERENCES users(id),
        metadata jsonb NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT booking_events_actor_type_chk
          CHECK (actor_type IN ('customer', 'salon_owner', 'admin', 'system'))
      )
    `);
    // The only read pattern: one booking's timeline, oldest-first.
    await q.query(`CREATE INDEX booking_events_booking_idx ON booking_events (booking_id, created_at)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE booking_events`);
    await q.query(`DELETE FROM platform_config WHERE key = 'booking_approval_timeout_minutes'`);
    await q.query(`DROP INDEX bookings_payment_expiry_idx`);
    await q.query(`DROP INDEX bookings_approval_expiry_idx`);
    await q.query(`
      ALTER TABLE bookings
        DROP CONSTRAINT bookings_confirmation_mode_chk,
        DROP COLUMN payment_expires_at,
        DROP COLUMN approval_expires_at,
        DROP COLUMN confirmation_mode
    `);
    await q.query(`
      ALTER TABLE salons
        DROP CONSTRAINT salons_payment_timeout_chk,
        DROP CONSTRAINT salons_approval_timeout_chk,
        DROP CONSTRAINT salons_booking_confirmation_mode_chk,
        DROP COLUMN payment_timeout_minutes,
        DROP COLUMN approval_timeout_minutes,
        DROP COLUMN booking_confirmation_mode
    `);
  }
}
