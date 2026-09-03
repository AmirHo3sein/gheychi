import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Every public handle a salon has ever released, so a renamed salon's old link never dies.
 *
 * Two jobs, both of which fall out of `slug` being the PRIMARY KEY rather than an ordinary
 * indexed column:
 *
 * 1. **Redirect source.** `salon.slug` is the shareable link (see
 *    docs/technical-overview/31-public-handle-and-attribution.md) and it is printed onto QR
 *    codes that live on physical signage. A rename used to overwrite it with nothing kept, so
 *    every printed artifact 404'd the instant an owner tidied their handle. A row here lets
 *    `/salons/<old>` resolve to the salon's current handle and answer with a real 301.
 *
 * 2. **Anti-hijack reservation.** A freed handle used to be immediately claimable by anyone,
 *    which meant a competitor could take a salon's former handle and silently inherit all of
 *    its existing printed-QR traffic. The primary key makes "this handle is spoken for,
 *    forever" a database invariant rather than an application-level check that some future
 *    call site could forget: the row simply cannot be duplicated, and it can only disappear
 *    when the salon that released it reclaims it (or the salon itself is deleted, via the
 *    ON DELETE CASCADE -- at which point nothing is left to redirect to anyway).
 *
 * Deliberately never backfilled: a salon's *current* slug is not history, and no
 * pre-existing salon has released one through any code path that existed before this table.
 */
@Entity('salon_slug_history')
export class SalonSlugHistory {
  // Same varchar(180) width as salons.slug (1751600000000-initial-schema) -- this column
  // holds values that were literally in that one, so a narrower type would be a latent
  // truncation/insert failure on the longest legal handle.
  @PrimaryColumn({ type: 'varchar', length: 180 })
  slug: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @CreateDateColumn({ name: 'released_at' })
  releasedAt: Date;
}
