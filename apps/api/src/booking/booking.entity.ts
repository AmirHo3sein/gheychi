import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { bigintToNumber, nullableBigintToNumber } from '../common/numeric-transformers';

export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'completed'
  | 'cancelled_by_user'
  | 'cancelled_by_salon'
  | 'expired'
  | 'no_show';

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

  // Owner-authored free text on a manual booking (e.g. "تماس تلفنی - مشتری قدیمی") -- always
  // null for an online booking; there's nowhere in that flow for a customer to write one.
  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
