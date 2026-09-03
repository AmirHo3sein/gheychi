import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintToNumber, nullableBigintToNumber } from '../common/numeric-transformers';

export type BookingStatus =
  // Manual-approval mode only: the customer has asked for this slot and the salon
  // has not yet decided. Holds capacity exactly like a paid-for slot would, but no
  // Payment row and no gateway session exist yet -- so rejecting/expiring one never
  // owes anyone a refund.
  | 'pending_approval'
  | 'pending_payment'
  | 'confirmed'
  | 'completed'
  | 'cancelled_by_user'
  | 'cancelled_by_salon'
  // Manual-approval mode only: the salon actively declined the request. Deliberately
  // distinct from cancelled_by_salon (which always means "a real, already-confirmed
  // appointment was called off, refund the customer") so the two can never be confused
  // in reporting, in refund logic, or by a customer reading their own history.
  | 'rejected_by_salon'
  | 'expired'
  | 'no_show';

/**
 * Which booking workflow a salon runs. Provider-selectable (the ONE booking setting an
 * owner controls); every timing value around it is admin-only.
 */
export type BookingConfirmationMode = 'automatic' | 'manual_approval';

/**
 * Statuses that occupy a slot for availability/capacity purposes. `pending_approval`
 * belongs here for the same reason `pending_payment` does: the customer is holding the
 * slot while an outcome is pending, and letting someone else book over it would mean the
 * salon could approve a request it has no room for.
 *
 * Exported as one shared constant precisely because this list was previously written out
 * inline at six separate call sites (createHold's two overlap checks, createManual's two,
 * assignWorker's, and AvailabilityService's) -- adding a status by hand at five of six
 * would produce a silent, intermittent double-booking bug rather than a test failure.
 */
export const SLOT_BLOCKING_STATUSES: BookingStatus[] = ['pending_approval', 'pending_payment', 'confirmed'];

/**
 * Statuses where the appointment is definitively off -- it never happened and never will.
 * Distinct from "not slot-blocking": a completed or no-show booking also stops blocking its
 * slot, but it is a real historical record a salon may still legitimately annotate (most
 * importantly, assigning the worker who actually did the work, which is what a customer's
 * worker rating hangs off). Only these statuses mean "there is nothing here to edit".
 */
export const DEAD_BOOKING_STATUSES: BookingStatus[] = [
  'cancelled_by_user',
  'cancelled_by_salon',
  'rejected_by_salon',
  'expired',
];

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'salon_id' })
  salonId: string;

  @Column({ name: 'service_id' })
  serviceId: string;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({ name: 'price_snapshot', type: 'bigint', transformer: bigintToNumber })
  priceSnapshot: number;

  @Column({ name: 'deposit_amount', type: 'bigint', transformer: bigintToNumber })
  depositAmount: number;

  @Column({ type: 'varchar', default: 'pending_payment' })
  status: BookingStatus;

  @Column({ name: 'reminded_at', type: 'timestamptz', nullable: true })
  remindedAt: Date | null;

  @Column({ name: 'coupon_id', type: 'uuid', nullable: true })
  couponId: string | null;

  // Set when the winning discount (service vs coupon, resolved by
  // discount.util.ts's resolveBestPrice) was percent-kind. Mutually exclusive with
  // discountFixedAmount below (bookings_discount_shape_chk) -- both null means no
  // discount applied at all.
  @Column({ name: 'discount_percent', type: 'int', nullable: true })
  discountPercent: number | null;

  // Set when the winning discount was fixed-toman-kind (Slice 6 -- a fixed_discount
  // referral-issued coupon). This is the LITERAL mechanism that was actually applied,
  // recorded losslessly -- deliberately NOT approximated as an equivalent display
  // percent on discountPercent above, so a future reader can never mistake an
  // approximation for the real discount type. originalPriceSnapshot (below) already
  // holds the pre-discount price either way, so "amount saved" is always
  // reconstructable (originalPriceSnapshot - priceSnapshot) regardless of which of
  // these two columns is populated.
  @Column({ name: 'discount_fixed_amount', type: 'bigint', nullable: true, transformer: nullableBigintToNumber })
  discountFixedAmount: number | null;

  // The pre-discount service price, only set when discountPercent is non-null;
  // priceSnapshot holds the final (post-discount) price that was actually charged.
  @Column({ name: 'original_price_snapshot', type: 'bigint', nullable: true, transformer: nullableBigintToNumber })
  originalPriceSnapshot: number | null;

  // Which worker performed the service -- null for solo owner-operated salons that
  // never assign one. Required for worker rating (ReviewsService.create) and drives
  // the customer-facing workerName enrichment in BookingsService.attachNames.
  @Column({ name: 'worker_id', type: 'uuid', nullable: true })
  workerId: string | null;

  // How much of THIS booking's depositAmount was funded from the customer's wallet
  // balance rather than charged online -- null means wallet wasn't applied. Debited
  // (and, if the hold dies before payment, credited back) by
  // booking-hold-release.util.ts's releaseBookingHold, mirroring how couponId tracks
  // a coupon's spend/release lifecycle. depositAmount itself already reflects the
  // reduced online-payable amount (deposit - walletAmountUsed) -- this column exists
  // only so that reduction is traceable back to the wallet, not to record a second
  // "full" deposit figure.
  @Column({ name: 'wallet_amount_used', type: 'bigint', nullable: true, transformer: nullableBigintToNumber })
  walletAmountUsed: number | null;

  // 'online' (the default, and every booking before this column existed) came through
  // createHold's normal customer-facing flow; 'manual' came through
  // BookingsService.createManual -- the owner recording a walk-in/phone customer who isn't
  // otherwise in the system. Never set by createHold itself; the DB DEFAULT covers it.
  @Column({ type: 'varchar', default: 'online' })
  source: 'online' | 'manual';

  // Marketing-channel attribution -- distinct from `source` above (creation mechanism, not
  // marketing channel). Null means no attributable channel (organic in-app navigation, the
  // common case) or a 'manual' booking (nothing to attribute). Set once at creation from
  // CreateBookingDto.attributionSource, never recomputed -- a durable per-booking join for
  // "how did this customer find us", see docs/technical-overview/31-public-handle-and-attribution.md.
  @Column({ name: 'attribution_source', type: 'varchar', length: 20, nullable: true })
  attributionSource: 'qr' | 'direct' | 'search' | null;

  // Owner-authored free text on a manual booking (e.g. "تماس تلفنی - مشتری قدیمی") -- always
  // null for an online booking; there's nowhere in that flow for a customer to write one.
  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  // Which workflow this booking was CREATED under, snapshotted so a salon switching
  // its own mode later never retroactively changes how an already-in-flight booking
  // behaves (an approved-and-awaiting-payment request must not silently become an
  // "automatic" booking, nor vice versa). Every pre-existing row backfills to
  // 'automatic' via the column DEFAULT, which is exactly what they already were.
  @Column({ name: 'confirmation_mode', type: 'varchar', default: 'automatic' })
  confirmationMode: BookingConfirmationMode;

  // Immutable deadline snapshot: when the salon's window to accept/decline this
  // request runs out. Only ever set for a manual_approval booking, at creation.
  // Snapshotted rather than recomputed at job time so an admin editing the timeout
  // never moves the goalposts under a request that is already pending.
  @Column({ name: 'approval_expires_at', type: 'timestamptz', nullable: true })
  approvalExpiresAt: Date | null;

  // Immutable deadline snapshot: when the customer's window to pay runs out. Set the
  // moment the booking enters pending_payment -- at creation for an automatic booking,
  // at approval time for a manual one. NULL on rows created before this column existed;
  // BookingExpiryJob falls back to the old created_at + live-TTL derivation for those,
  // so no historical booking's behaviour changed when this shipped.
  @Column({ name: 'payment_expires_at', type: 'timestamptz', nullable: true })
  paymentExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
