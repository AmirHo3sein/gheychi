import { MigrationInterface, QueryRunner } from 'typeorm';

export class CategoryRequests1755100000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE category_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        requester_id uuid NOT NULL REFERENCES users(id),
        salon_id uuid NOT NULL REFERENCES salons(id),
        name varchar(60) NOT NULL,
        note text NULL,
        status varchar(20) NOT NULL DEFAULT 'pending',
        resolution_note text NULL,
        resolved_by uuid NULL REFERENCES users(id),
        resolved_at timestamptz NULL,
        -- ON DELETE SET NULL, not RESTRICT: a request row is a historical record of what
        -- was asked and when -- deleting the category it resulted in (e.g. an admin
        -- correcting a mistake later) must not resurrect a foreign-key error on an
        -- otherwise-inert, already-resolved request row.
        category_id int NULL REFERENCES service_categories(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT category_requests_status_chk CHECK (status IN ('pending', 'approved', 'rejected'))
      )
    `);
    await q.query(`CREATE INDEX category_requests_salon_idx ON category_requests (salon_id, created_at DESC)`);
    await q.query(`CREATE INDEX category_requests_status_idx ON category_requests (status, created_at DESC)`);
    // At most one PENDING request per (salon, case-insensitive name) -- a provider
    // double-tapping "submit" (or requesting the same name twice while the first is
    // still pending) gets a clean 409 instead of two identical rows in the queue. An
    // already-resolved (approved/rejected) row never blocks a fresh request for the
    // same name, since the partial index only covers status='pending'.
    await q.query(`
      CREATE UNIQUE INDEX category_requests_salon_name_pending_uidx
        ON category_requests (salon_id, lower(name)) WHERE status = 'pending'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE category_requests`);
  }
}
