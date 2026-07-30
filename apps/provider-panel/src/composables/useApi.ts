import { useToast } from './useToast'

export interface ApiError {
  status: number
  message: string
}

export interface ApiResult<T> {
  data: T | null
  error: ApiError | null
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  silent?: boolean
  /** Set to false to suppress the automatic redirect-to-/login on a 401 (defaults to true). */
  redirectOn401?: boolean
}

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3002/api'

/**
 * Shown instead of a DTO rejection's own text. Nest's global ValidationPipe reports a failed
 * `class-validator` check as `message: string[]` of English sentences ("durationMin must not
 * be less than 5"); this panel is Persian-only, so those must never reach a toast. Every
 * screen validates its own fields before submitting, so a 400 arriving here means a client
 * check was missed -- this is the safety net for that, not the primary feedback channel.
 */
const VALIDATION_ERROR_FA = 'اطلاعات واردشده معتبر نیست. مقادیر فرم را بررسی کنید.'

/**
 * Nest sends `message` as a string for hand-thrown exceptions (many of them already Persian)
 * and as a string array only for ValidationPipe failures, which are always a 400. Arrays on
 * any other status are joined rather than dropped -- nothing produces them today, but a bare
 * array interpolated into a toast renders as `[ "…" ]`, which is worse than the joined text.
 */
export function normalizeApiMessage(status: number, raw: unknown): string | null {
  if (Array.isArray(raw)) {
    if (status === 400) return VALIDATION_ERROR_FA
    const joined = raw.filter((part): part is string => typeof part === 'string').join('؛ ')
    return joined === '' ? null : joined
  }
  return typeof raw === 'string' && raw !== '' ? raw : null
}

export function useApi() {
  async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<ApiResult<T>> {
    const isFormData = options.body instanceof FormData

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: options.method ?? 'GET',
        credentials: 'include',
        headers: isFormData ? undefined : { 'Content-Type': 'application/json' },
        body:
          options.body === undefined
            ? undefined
            : isFormData
              ? (options.body as FormData)
              : JSON.stringify(options.body),
      })

      if (!res.ok) {
        let message = 'خطایی رخ داد'
        try {
          const body = (await res.json()) as { message?: unknown } | null
          message = normalizeApiMessage(res.status, body?.message) ?? message
        } catch {
          // response body wasn't JSON -- keep the default message
        }
        const apiError: ApiError = { status: res.status, message }

        if (apiError.status === 401) {
          if (options.redirectOn401 !== false) window.location.href = '/login'
          return { data: null, error: apiError }
        }

        if (!options.silent) useToast().push(message)
        return { data: null, error: apiError }
      }

      const data = res.status === 204 ? null : ((await res.json()) as T)
      return { data, error: null }
    } catch {
      const apiError: ApiError = { status: 0, message: 'خطا در ارتباط با سرور' }
      if (!options.silent) useToast().push(apiError.message)
      return { data: null, error: apiError }
    }
  }

  return { apiFetch }
}
