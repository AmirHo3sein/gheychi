import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Trust & launch-readiness guards for bookings (spec 2026-10-08-trust-and-launch-readiness-design).
 *
 * 1. `bookings.cancellation_window_hours` -- the cancellation window in force at creation,
 *    frozen onto the row. Before this, cancel() and reschedule() read the LIVE platform
 *    config, so an admin editing the window silently rewrote the terms of every booking
 *    already made. Existing rows are backfilled from the current config value, which is
 *    the only window they could ever have been judged against.
 * 2. `booking_max_active_per_user` / `booking_max_active_per_salon_per_user` -- the abuse
 *    caps on a customer's active future bookings, admin-editable platform config.
 *
 * `cancelled_by_admin` needs no schema change: bookings.status is an unconstrained
 * varchar(20) and the new value is 18 characters.
 */
export class BookingTrustGuards1758000000000 implements MigrationInterface {
  name = 'BookingTrustGuards1758000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE bookings ADD COLUMN cancellation_window_hours int`);
    await queryRunner.query(
      `UPDATE bookings
          SET cancellation_window_hours =
            (SELECT ROUND((value #>> '{}')::numeric)::int FROM platform_config WHERE key = 'cancellation_window_hours')`,
    );
    await queryRunner.query(
      `INSERT INTO platform_config (key, value) VALUES
         ('booking_max_active_per_user', '5'),
         ('booking_max_active_per_salon_per_user', '2')
       ON CONFLICT (key) DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM platform_config WHERE key IN ('booking_max_active_per_user', 'booking_max_active_per_salon_per_user')`,
    );
    await queryRunner.query(`ALTER TABLE bookings DROP COLUMN cancellation_window_hours`);
  }
}
