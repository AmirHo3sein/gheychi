import { MigrationInterface, QueryRunner } from 'typeorm';

// Handle history + permanent redirects + anti-hijack reservation -- see
// salon-slug-history.entity.ts's own doc comment and
// docs/technical-overview/31-public-handle-and-attribution.md.
//
// `slug` is the PRIMARY KEY on purpose: "a released handle stays spoken for, forever" becomes
// a database invariant instead of an application check. Same varchar(180) width/charset as
// salons.slug, since every value here was literally in that column a moment earlier.
//
// ON DELETE CASCADE, not RESTRICT: once the salon is gone there is nothing left to redirect
// to, so keeping its former handles reserved would only sterilise them for everyone.
//
// Deliberately NO backfill -- a salon's current slug is not history, and no salon has ever
// released one through a code path that existed before this table.
export class SalonSlugHistory1756400000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE salon_slug_history (
        slug varchar(180) PRIMARY KEY,
        salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        released_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Drives the "is this one of MY own former handles?" reclaim check and any per-salon
    // listing; the PK already covers the by-slug redirect lookup.
    await q.query(`CREATE INDEX salon_slug_history_salon_idx ON salon_slug_history (salon_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE salon_slug_history`);
  }
}
