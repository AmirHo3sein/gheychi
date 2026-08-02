import { EntityManager, In } from 'typeorm';
import { CouponRedemption } from '../coupons/coupon-redemption.entity';
import { WalletService } from '../wallet/wallet.service';
import { Booking } from './booking.entity';

/**
 * Gives a coupon code, and any wallet balance applied to the deposit, back to the
 * customer when the booking that consumed them dies before any money moved.
 *
 * BookingsService.createHold inserts the CouponRedemption row (and debits the wallet)
 * inside the hold-creation transaction -- deliberately, because UNIQUE(coupon_id, user_id)
 * and the max_redemptions cap are only race-safe if the row exists from the moment the
 * discounted price is promised, and the wallet balance must already be reserved so a
 * second concurrent hold can't also spend it. The cost is that an abandoned hold would
 * otherwise burn both forever: the coupon's unique index locks the user out permanently
 * (and for a referral-issued coupon, destroys a reward the platform already granted with
 * no reissue path), and the wallet debit would vanish real credit the customer never
 * actually spent on anything.
 *
 * So every path that takes a booking out of pending_payment WITHOUT capturing the
 * deposit releases both: BookingExpiryJob, BookingsService.cancel's pending_payment
 * branch, PaymentsService's failed/declined callback, and PaymentReconciliationJob's
 * verify-failed branch. A path where money WAS captured (including a captured-then-
 * refunded booking) deliberately keeps both -- the code and the wallet balance were
 * really spent, funding a deposit the platform genuinely holds; refund-time reversal of
 * either is a separate, not-yet-built concern (same as the referral system's own
 * documented refund-reversal boundary).
 *
 * Safe to call for a booking that never had a coupon or never used its wallet (both
 * degrade to a no-op), and safe to call twice for the same booking (the coupon delete
 * is a zero-row DELETE the second time; the wallet credit-back is skipped because
 * walletAmountUsed is only ever read off the still-pending_payment booking row, which
 * every real call site transitions out of pending_payment in the same transaction as
 * this call -- so a genuine double-release of the wallet portion can't happen via the
 * documented call sites above).
 */
export async function releaseBookingHold(
  em: EntityManager,
  walletService: WalletService,
  bookingIds: string | string[],
): Promise<void> {
  const ids = Array.isArray(bookingIds) ? bookingIds : [bookingIds];
  if (ids.length === 0) return;

  await em.delete(CouponRedemption, { bookingId: In(ids) });

  const rows = await em.find(Booking, {
    where: { id: In(ids) },
    select: ['id', 'userId', 'walletAmountUsed'],
  });
  for (const row of rows) {
    if (!row.walletAmountUsed) continue;
    await walletService.credit(em, row.userId, 'toman', row.walletAmountUsed, 'booking_spend_reversal', {
      referenceType: 'booking',
      referenceId: row.id,
      reason: 'Booking hold released before its deposit was captured',
    });
  }
}
