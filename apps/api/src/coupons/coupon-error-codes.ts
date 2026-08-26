/**
 * Stable, machine-readable codes for the coupon-validation failures thrown by
 * CouponsService.resolveAndValidate (and BookingsService.createHold's own
 * duplicate-redemption race backstop, which reuses COUPON_ALREADY_REDEEMED for the
 * same real-world failure -- see the comment at that catch site). Carried on the
 * BadRequestException response body's `code` field alongside the existing
 * human-readable Persian `message`, so a caller (the booking page's mentionsCoupon
 * replacement) can identify the failure kind without string-matching localized copy.
 *
 * Not a general error-code convention for the API -- this codebase has none yet --
 * just the minimal structured body needed to make this one UX path robust against
 * message rewording. See docs/technical-overview/24-technical-debt.md.
 */
export const COUPON_INVALID = 'COUPON_INVALID';
export const COUPON_EXPIRED = 'COUPON_EXPIRED';
export const COUPON_ALREADY_REDEEMED = 'COUPON_ALREADY_REDEEMED';
export const COUPON_LIMIT_REACHED = 'COUPON_LIMIT_REACHED';
// Platform-wide kill switch (feature_coupons_enabled), not a problem with this
// specific code -- kept distinct from COUPON_INVALID so a client can tell "your code is
// wrong" apart from "coupons are off right now" and message the user accordingly.
export const COUPON_FEATURE_DISABLED = 'COUPON_FEATURE_DISABLED';

export type CouponErrorCode =
  | typeof COUPON_INVALID
  | typeof COUPON_EXPIRED
  | typeof COUPON_ALREADY_REDEEMED
  | typeof COUPON_LIMIT_REACHED
  | typeof COUPON_FEATURE_DISABLED;
