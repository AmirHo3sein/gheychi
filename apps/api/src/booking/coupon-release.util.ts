import { EntityManager, In } from 'typeorm';
import { CouponRedemption } from '../coupons/coupon-redemption.entity';

/**
 * Gives a coupon code back to the customer when the booking that consumed it dies
 * before any money moved.
 *
 * BookingsService.createHold inserts the CouponRedemption row inside the
 * hold-creation transaction -- deliberately, because UNIQUE(coupon_id, user_id) and
 * the max_redemptions cap are only race-safe if the row exists from the moment the
 * discounted price is promised. The cost is that an abandoned hold would otherwise
 * burn the code forever: the unique index locks the user out permanently and the row
 * keeps consuming a max_redemptions slot, which for a referral-issued coupon destroys
 * a reward the platform already granted and has no reissue path for.
 *
 * So every path that takes a booking out of pending_payment WITHOUT capturing the
 * deposit releases the redemption: BookingExpiryJob, BookingsService.cancel's
 * pending_payment branch, PaymentsService's failed/declined callback, and
 * PaymentReconciliationJob's verify-failed branch. A path where money WAS captured
 * (including a captured-then-refunded booking) deliberately keeps the redemption --
 * the code was really spent, and refund-time reversal is the referral system's
 * documented, separate concern.
 *
 * Deleting is safe to repeat and safe to call for a booking that never had a coupon
 * (both are simply a zero-row DELETE), so callers don't have to check first.
 */
export async function releaseCouponRedemption(em: EntityManager, bookingIds: string | string[]): Promise<void> {
  const ids = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
  if (ids.length === 0) return;
  await em.delete(CouponRedemption, { bookingId: In(ids) });
}
