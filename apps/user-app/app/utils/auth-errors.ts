// apps/user-app/app/utils/auth-errors.ts
// Honest Persian copy for the OTP login failure modes.
//
// The API's own messages are English ('Invalid or expired code', 'Too many OTP requests'),
// so they can never be shown to a user in this Persian-only app -- but the naive
// alternative (a single hardcoded string per call) is worse: it reports a rate limit or a
// dead network as bad user input, sending the user off to "fix" a phone number that was
// correct all along. Map by status instead, and only fall back to the input-validation
// message for statuses that genuinely mean bad input.
import type { ApiError } from '~/composables/useApi'

/**
 * The OTP limiter allows OtpService's RATE_LIMIT_MAX requests per RATE_WINDOW_SEC
 * (3 per hour). The window is what makes the 429 message honest -- "wait a moment" would
 * be a lie for an hour-long lockout, and a user told that just keeps retrying.
 */
const RATE_WINDOW_LABEL = 'یک ساعت'

export function describeAuthError(error: ApiError, invalidMessage: string): string {
  // status 0 is useApi's marker for "no HTTP response at all" -- not a server verdict.
  if (error.status === 0) {
    return 'اتصال اینترنت برقرار نیست. اتصال خود را بررسی کنید و دوباره تلاش کنید.'
  }
  if (error.status === 429) {
    return `تعداد درخواست کد بیش از حد مجاز است. تا ${RATE_WINDOW_LABEL} آینده امکان درخواست کد جدید نیست.`
  }
  if (error.status >= 500) {
    return 'خطایی در سرور رخ داده است. لطفاً چند لحظه دیگر دوباره تلاش کنید.'
  }
  return invalidMessage
}

/**
 * The verify endpoint answers 401 for a wrong code, an expired code AND a code burned by
 * too many wrong attempts -- it deliberately doesn't distinguish them, so neither can we.
 * Saying only "wrong code" is actively misleading for the expiry case: the user retypes the
 * same correct digits and fails again with no hint that time ran out. Name both causes and
 * point at the way out.
 */
export const CODE_REJECTED_MESSAGE = 'کد وارد شده نادرست یا منقضی شده است. کد جدید درخواست کنید.'

/** Shown once the client-side expiry countdown reaches zero, before the user even submits. */
export const CODE_EXPIRED_MESSAGE = 'مدت اعتبار کد به پایان رسید. برای ادامه، کد جدید درخواست کنید.'

/** mm:ss for the expiry countdown. Persian digits are applied by the template's `tnum` styling. */
export function formatCountdown(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
