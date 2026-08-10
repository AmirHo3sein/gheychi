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
 * degrade to a no-op), and safe to call twice for the same booking: the coupon delete
 * is a zero-row DELETE the second time, and the wallet credit-back is guarded by its
 * own conditional UPDATE (clearing wallet_amount_used to 0, matched against the value
 * just read) -- only the call that actually wins that race credits the wallet. This is
 * NOT merely "every real call site already guards itself before calling in" (that used
 * to be the claim here, and it was wrong: PaymentsService.markFailed and
 * PaymentReconciliationJob's verify-failed branch both call in unconditionally,
 * regardless of whether their own booking-status CAS won, so two callers reaching this
 * function for the same booking -- e.g. a back-button + refresh double-delivering a
 * declined callback, or a declined callback racing the reconciliation job -- used to
 * double-credit the wallet for money that was only ever spent once. The guard belongs
 * here, once, rather than relying on every current and future call site to remember it.
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
    // Conditional UPDATE -- same status-guarded pattern as every other money-moving
    // write in this codebase (PaymentsService's conditional payment/booking CAS,
    // WalletService's row lock). Clears wallet_amount_used to 0 ONLY IF it still holds
    // the value just read; a losing concurrent/duplicate call sees affected=0 (someone
    // else already cleared it) and skips the credit entirely.
    const cleared: unknown[] = await em.query(
      `UPDATE bookings SET wallet_amount_used = 0 WHERE id = $1 AND wallet_amount_used = $2 RETURNING id`,
      [row.id, row.walletAmountUsed],
    );
    if (cleared.length === 0) continue;
    await walletService.credit(em, row.userId, 'toman', row.walletAmountUsed, 'booking_spend_reversal', {
      referenceType: 'booking',
      referenceId: row.id,
      reason: 'Booking hold released before its deposit was captured',
    });
  }
}
