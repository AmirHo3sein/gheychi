import { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkersAndWorkerRatings1753000000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    // Salon roster row backed by a real User (findOrCreateByPhone on add, same lazy-
    // creation idiom already used for OTP signup). One salon per worker; a worker is
    // soft-deactivated (active=false), never hard-deleted, so bookings.worker_id and
    // worker_ratings keep resolving to a real historical row after someone leaves.
    await q.query(`
      CREATE TABLE workers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        name varchar(120) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        rating_avg numeric(3,2) NOT NULL DEFAULT 0,
        rating_count int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    // One worker row per (salon, user) -- the same person can't be added to the same
    // salon's roster twice.
    await q.query(`CREATE UNIQUE INDEX workers_salon_user_uidx ON workers(salon_id, user_id)`);
    await q.query(`CREATE INDEX workers_salon_active_idx ON workers(salon_id, active)`);

    // Records which worker performed the service -- required for worker rating.
    // Nullable because solo owner-operated salons will simply never populate it.
    await q.query(`ALTER TABLE bookings ADD COLUMN worker_id uuid NULL REFERENCES workers(id) ON DELETE SET NULL`);
    await q.query(`CREATE INDEX bookings_worker_idx ON bookings(worker_id) WHERE worker_id IS NOT NULL`);

    // Kept structurally identical to `reviews` (own status, own recompute-under-lock
    // aggregate on workers.rating_avg/rating_count) but as its own table, not a Review
    // extension -- a booking has zero-or-one worker, so folding this into Review would
    // mean two permanently-null columns on every non-worker booking, and it would
    // conflate two different moderation surfaces (salon reply vs. stylist conduct).
    // review_id UNIQUE (not booking_id UNIQUE) is the deliberate lifecycle anchor --
    // one worker rating per Review row, inheriting reviews_booking_uidx's one-per-
    // booking guarantee transitively. booking_id/salon_id/user_id are denormalized
    // copies for query convenience, same rationale as reviews.salon_id.
    await q.query(`
      CREATE TABLE worker_ratings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        review_id uuid NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE CASCADE,
        booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
        worker_id uuid NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
        status varchar(20) NOT NULL DEFAULT 'published' CHECK (status IN ('published','rejected')),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX worker_ratings_worker_status_idx ON worker_ratings(worker_id, status)`);

    // Review edit/delete window (Product Decision 5) -- read via
    // PlatformConfigService.getReviewEditWindowHours(), same getX() pattern as every
    // other numeric platform_config key.
    await q.query(`INSERT INTO platform_config (key, value) VALUES ('review_edit_window_hours', '72')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM platform_config WHERE key = 'review_edit_window_hours'`);
    await q.query(`DROP TABLE worker_ratings`);
    await q.query(`ALTER TABLE bookings DROP COLUMN worker_id`);
    await q.query(`DROP TABLE workers`);
  }
}
