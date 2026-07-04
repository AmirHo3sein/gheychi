import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReviewsSchema1751800000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE reviews (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id uuid NOT NULL REFERENCES bookings(id),
        salon_id uuid NOT NULL REFERENCES salons(id),
        user_id uuid NOT NULL REFERENCES users(id),
        rating int NOT NULL,
        comment text,
        status varchar(20) NOT NULL DEFAULT 'published',
        salon_reply text,
        salon_reply_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    // UNIQUE on booking_id is the actual enforcement of "verified bookings only,
    // one review per completed booking" per the design spec's data-model section --
    // an index (not an inline column constraint) to match this codebase's existing
    // convention for the same shape of constraint (see payments_booking_uidx in
    // 1751700000000-booking-payments-schema.ts).
    await q.query(`CREATE UNIQUE INDEX reviews_booking_uidx ON reviews(booking_id)`);
    // Matches the exact query shape of the public listing endpoint (Task 3):
    // WHERE salon_id = $1 AND status = 'published', ordered by created_at.
    await q.query(`CREATE INDEX reviews_salon_status_idx ON reviews(salon_id, status)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE reviews`);
  }
}
