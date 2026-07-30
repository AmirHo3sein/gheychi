import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Availability used to build slot instants by treating a salon's working-hour digits as UTC:
 * an `open_time` of 09:00 -- which the provider typed on their own Iran clock -- became the
 * instant 09:00Z. Every display path then formatted that instant in Asia/Tehran, so it
 * rendered as 12:30 and a salon open 09:00-20:00 was bookable 12:30-23:30.
 *
 * `computeAvailableSlots` now converts Iran wall clock to a real UTC instant at its boundary
 * (09:00 Iran -> 05:30Z). Rows written before that change therefore hold instants that are
 * 3h30m LATER than the wall-clock appointment they were meant to represent, and would render
 * 3h30m late next to any booking created afterwards.
 *
 * This shifts those pre-existing rows back by the offset so the whole table means one thing.
 * Two reasons it is safe to apply unconditionally:
 *  - Migrations run exactly once (tracked in the `migrations` table), so it cannot double-apply.
 *  - It runs before any row can exist under the new convention, because the code change and
 *    this migration ship together.
 *
 * Deliberately NOT touched:
 *  - `working_hours.open_time`/`close_time` -- still wall clock by design; that is the input
 *    the conversion consumes, not an instant.
 *  - `schedule_exceptions.date` -- a calendar day, not an instant.
 *  - `payments.*`, `created_at`/`updated_at` everywhere -- real instants recorded by the
 *    server clock, never derived from a slot, so they were always correct.
 */
export class ShiftBookingsToRealUtcInstants1753600000000 implements MigrationInterface {
  private static readonly OFFSET = `INTERVAL '3 hours 30 minutes'`;

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE bookings
      SET starts_at = starts_at - ${ShiftBookingsToRealUtcInstants1753600000000.OFFSET},
          ends_at   = ends_at   - ${ShiftBookingsToRealUtcInstants1753600000000.OFFSET}
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE bookings
      SET starts_at = starts_at + ${ShiftBookingsToRealUtcInstants1753600000000.OFFSET},
          ends_at   = ends_at   + ${ShiftBookingsToRealUtcInstants1753600000000.OFFSET}
    `);
  }
}
