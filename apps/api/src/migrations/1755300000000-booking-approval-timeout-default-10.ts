import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lowers the global approval timeout from 30 to 10 minutes.
 *
 * A product decision, not a tuning tweak: 30 minutes is far too long to leave a customer
 * holding a slot they cannot pay for while they wait on a salon owner who may not be
 * looking at their phone. Ten minutes bounds that wait, and the slot is released quickly
 * enough that another customer can still take it.
 *
 * A separate migration rather than an edit to 1755200000000, because that one has already
 * shipped -- anyone who has run it would otherwise silently keep the old default forever.
 */
export class BookingApprovalTimeoutDefault101755300000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // Guarded on the value still being the original 30: if an admin has already tuned this
    // key through PATCH /admin/config, that is a deliberate operational choice and a
    // migration has no business overwriting it.
    await q.query(
      `UPDATE platform_config SET value = '10' WHERE key = 'booking_approval_timeout_minutes' AND value::text = '30'`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE platform_config SET value = '30' WHERE key = 'booking_approval_timeout_minutes' AND value::text = '10'`,
    );
  }
}
