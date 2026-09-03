import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { BookingConfirmationMode, BookingStatus } from '../booking.entity';
import { PaymentStatus } from '../payment.entity';

// Spelled out rather than derived from the union type -- @IsIn needs runtime values, and
// listing them here means adding a BookingStatus member without deciding whether admins
// may filter on it is a compile error at the annotation below, not a silent 400 later.
const BOOKING_STATUSES: BookingStatus[] = [
  'pending_approval',
  'pending_payment',
  'confirmed',
  'completed',
  'cancelled_by_user',
  'cancelled_by_salon',
  'rejected_by_salon',
  'expired',
  'no_show',
];
const CONFIRMATION_MODES: BookingConfirmationMode[] = ['automatic', 'manual_approval'];
const PAYMENT_STATUSES: PaymentStatus[] = ['initiated', 'paid', 'refund_pending', 'refunded', 'failed'];

/**
 * GET /admin/bookings -- mirrors AdminSalonQueryDto/AdminInvoiceQueryDto's filter+paginate
 * shape (page/pageSize/`{items,total,page,pageSize}`), which is the shape every list screen
 * in the admin panel already consumes. Every field is optional: an unfiltered call is the
 * legitimate "show me the most recent bookings" landing state.
 */
export class AdminBookingQueryDto {
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;

  @IsOptional()
  @IsUUID()
  salonId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsIn(CONFIRMATION_MODES)
  confirmationMode?: BookingConfirmationMode;

  // Creation mechanism (customer checkout vs. an owner recording a walk-in), NOT the
  // marketing channel -- see Booking.source / Booking.attributionSource.
  @IsOptional()
  @IsIn(['online', 'manual'])
  source?: 'online' | 'manual';

  // Filters on the booking's own Payment row. A booking with no Payment row at all
  // (pending_approval, or any zero-deposit/offline-payment booking) can never match any
  // value here -- that is correct, not a gap: "which bookings are stuck in refund_pending"
  // is precisely the dispute-handling question this filter exists for.
  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  paymentStatus?: PaymentStatus;

  // Appointment-time range (bookings.starts_at), inclusive on both ends -- deliberately
  // not created_at: an admin chasing a dispute thinks in terms of when the appointment
  // was, and starts_at is also this list's own sort key.
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
