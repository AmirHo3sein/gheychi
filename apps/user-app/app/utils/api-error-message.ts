// Customer-facing wording for a failed API call.
//
// The API writes its customer-actionable rejections in Persian (coupon, booking-window,
// ...), but plenty of messages are developer-facing English ('Booking cannot be cancelled
// in its current state', class-validator output, framework 404s). A message with no Persian
// letters in it is therefore never shown verbatim -- it is replaced by a status-based
// Persian sentence instead. Persian server messages pass through untouched.
const PERSIAN_TEXT = /[؀-ۿ]/

export const NETWORK_ERROR_MESSAGE = 'اتصال برقرار نشد؛ اینترنت خود را بررسی کنید'
export const GENERIC_ERROR_MESSAGE = 'مشکلی پیش آمد؛ لطفاً دوباره تلاش کنید'

const STATUS_FALLBACKS: Record<number, string> = {
  400: 'اطلاعات واردشده معتبر نیست',
  401: 'برای ادامه باید وارد حساب خود شوید',
  403: 'اجازه انجام این کار را ندارید',
  404: 'مورد درخواستی پیدا نشد',
  409: 'وضعیت این مورد تغییر کرده است؛ صفحه را تازه کنید و دوباره تلاش کنید',
  429: 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید',
}

/** The Persian server message when there is one, else null. Accepts Nest's string[] bodies. */
export function persianServerMessage(raw: unknown): string | null {
  const parts = (Array.isArray(raw) ? raw : [raw]).filter(
    (m): m is string => typeof m === 'string' && PERSIAN_TEXT.test(m),
  )
  const joined = parts.map((m) => m.trim()).filter(Boolean).join('، ')
  return joined || null
}

export function fallbackMessageForStatus(status: number): string {
  if (status === 0) return NETWORK_ERROR_MESSAGE
  return STATUS_FALLBACKS[status] ?? GENERIC_ERROR_MESSAGE
}

export function customerFacingApiMessage(status: number, raw: unknown): string {
  return persianServerMessage(raw) ?? fallbackMessageForStatus(status)
}
