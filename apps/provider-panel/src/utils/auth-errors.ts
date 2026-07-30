// apps/provider-panel/src/utils/auth-errors.ts
// Honest Persian copy for the OTP login failure modes. Lifted out of LoginView.vue so the
// mapping is unit-testable and so the wording stays in one place per app.
//
// The API's own messages are English ('Invalid or expired code', 'Too many OTP requests')
// and can never be shown in this Persian-only app; mapping by status is what keeps a rate
// limit or a dead network from being reported as bad user input.
import type { ApiError } from '@/composables/useApi'

/**
 * OtpService allows RATE_LIMIT_MAX requests per RATE_WINDOW_SEC -- 3 per hour. The window
 * matters for honesty: this used to say "wait a few moments", which is a lie for an
 * hour-long lockout and just makes the user retry into the same wall.
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
 * The verify endpoint answers 401 for a wrong code, an expired code AND a code burned by too
 * many wrong attempts, without distinguishing them -- so naming only "wrong" is misleading
 * for the expiry case, where the user retypes correct-but-stale digits and fails again.
 */
export const CODE_REJECTED_MESSAGE = 'کد وارد شده نادرست یا منقضی شده است. کد جدید درخواست کنید.'

/** Shown once the client-side expiry countdown reaches zero, before the user even submits. */
export const CODE_EXPIRED_MESSAGE = 'مدت اعتبار کد به پایان رسید. برای ادامه، کد جدید درخواست کنید.'

/** mm:ss for the expiry countdown. */
export function formatCountdown(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
