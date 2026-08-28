import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintToNumber } from '../common/numeric-transformers';

/**
 * Every lifecycle moment worth reconstructing later. Deliberately a superset of the
 * `Booking.status` transitions -- several of these (PAYMENT_INITIATED, SLOT_RELEASED)
 * describe things that happen *around* a status change and would otherwise be invisible
 * in a support investigation.
 *
 * Kept as a string union rather than a DB enum: the migration's column is a plain
 * varchar(40) so adding a member here is a code-only change, matching how
 * `BookingStatus` itself is modelled.
 */
export type BookingEventType =
  | 'BOOKING_CREATED'
  | 'APPROVAL_REQUESTED'
  | 'SALON_APPROVED'
  | 'SALON_REJECTED'
  | 'APPROVAL_EXPIRED'
  | 'PAYMENT_WINDOW_STARTED'
  | 'PAYMENT_INITIATED'
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_EXPIRED'
  | 'BOOKING_CONFIRMED'
  | 'SLOT_RELEASED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_COMPLETED'
  | 'BOOKING_NO_SHOW';

/**
 * Who caused the event. `system` covers every cron-driven transition (approval/payment
 * expiry), which genuinely has no human actor -- recording those as an admin or as the
 * customer would be a lie a support agent could act on.
 */
export type BookingEventActorType = 'customer' | 'salon_owner' | 'admin' | 'system';

/**
 * Append-only booking lifecycle history.
 *
 * Intentionally NOT the admin `audit_log`, which answers a different question. `audit_log`
 * records "which admin performed which administrative action", is filtered/browsed by
 * actor, and only ever covers admin mutations. This table records "what happened to this
 * booking", including every transition with no admin involved at all -- the customer's
 * own request, the salon's decision, and the cron jobs that expire both. Merging them
 * would make each one worse at its own job.
 */
@Entity('booking_events')
export class BookingEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Monotonic insertion order — the ONLY thing this table is ever sorted by.
   *
   * `createdAt` cannot serve that role: Postgres's `now()` is the transaction start time,
   * so events written in one transaction share a timestamp, and TypeORM's JS-side stamping
   * is only millisecond-resolution anyway. Database-generated, never set from application
   * code.
   */
  @Column({ type: 'bigint', generated: 'increment', transformer: bigintToNumber })
  seq: number;

  @Column({ name: 'booking_id' })
  bookingId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 40 })
  eventType: BookingEventType;

  @Column({ name: 'actor_type', type: 'varchar', length: 20 })
  actorType: BookingEventActorType;

  // Null for `system` events, and for any actor whose identity isn't a users row.
  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  // Free-form context (timeout values, resolved deadlines, rejection reason, ...).
  // MUST never carry a credential, payment authority, OTP, or raw auth data -- the
  // review responsibility sits with each call site, same rule as AnalyticsService.
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
