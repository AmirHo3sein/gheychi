/**
 * Stable, machine-readable codes for the booking-availability conflicts
 * BookingsService.createHold/createManual/assignWorker throw, and the payment-failure
 * outcome PaymentsService.handleCallback/PaymentsController produce -- same convention
 * as coupon-error-codes.ts (see that file's doc comment for the shape/rationale), just
 * extended to this second, still-bounded slice.
 *
 * BOOKING_UNAVAILABLE covers every booking-time conflict that is NOT about one specific
 * named worker: the per-salon capacity/slot-overlap check, and the per-salon Redis lock
 * ("someone else is booking right now") backstop that guards the same critical section.
 * WORKER_UNAVAILABLE is the narrower case -- a specific worker already has an
 * overlapping booking at that time -- which lets a caller (the booking page) tell "this
 * slot is gone entirely" apart from "try a different specialist, or no preference."
 * Carried on the BadRequestException/ConflictException response body's `code` field,
 * exactly like the coupon codes.
 *
 * PAYMENT_FAILED marks a genuine decline in PaymentsService.handleCallback (nothing was
 * captured -- Status=NOK from the bank, or a declined verify) as reported to the
 * customer. That outcome has no JSON response body of its own -- Zarinpal's callback is
 * a browser redirect, not a server-issued webhook -- so PaymentsController carries this
 * code as an additional `code` query param alongside the existing `status=failed`
 * redirect, unchanged. It is deliberately NOT set for the 'unknown-authority' outcome,
 * which also redirects to `status=failed` for the customer but is a distinct failure
 * mode (an authority this platform cannot attribute to any payment at all) rather than
 * a resolved decline.
 *
 * Not a general error-code convention for the API -- this codebase has none yet, see
 * coupon-error-codes.ts's own caveat, which applies verbatim here too.
 */
export const BOOKING_UNAVAILABLE = 'BOOKING_UNAVAILABLE';
export const WORKER_UNAVAILABLE = 'WORKER_UNAVAILABLE';
export const PAYMENT_FAILED = 'PAYMENT_FAILED';

export type BookingErrorCode = typeof BOOKING_UNAVAILABLE | typeof WORKER_UNAVAILABLE | typeof PAYMENT_FAILED;
