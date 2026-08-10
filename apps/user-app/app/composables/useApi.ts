export interface ApiError {
  /** 0 means a network/DNS/timeout failure with no HTTP response at all, not a real status code */
  status: number
  message: string
  /**
   * The API's stable, machine-readable error code, when the response body carried one
   * (e.g. coupon-validation failures -- see apps/api's coupon-error-codes.ts). Undefined
   * for responses with no structured `code` field at all, including every
   * network/DNS/timeout failure (status 0), which never reaches a JSON body to read one
   * from.
   */
  code?: string
}

export interface ApiResult<T> {
  data: T | null
  error: ApiError | null
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, unknown>
  silent?: boolean
  /** Set to false to suppress the automatic redirect-to-/login on a 401 (defaults to true). */
  redirectOn401?: boolean
}

export function useApi() {
  const config = useRuntimeConfig()

  async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {}
    if (import.meta.server) {
      // The browser's cookies never reach a server-side $fetch call automatically since
      // this is a separate origin from the API -- forward the incoming request's Cookie
      // header by hand, or every SSR-rendered page would look logged out.
      const forwarded = useRequestHeaders(['cookie'])
      if (forwarded.cookie) headers.cookie = forwarded.cookie
    }

    try {
      const data = await $fetch<T, string>(path, {
        baseURL: config.public.apiBase,
        method: options.method ?? 'GET',
        body: options.body as Record<string, unknown> | undefined,
        query: options.query,
        credentials: 'include',
        headers,
      })
      return { data, error: null }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status ?? 0
      // Read the API's own JSON `message` (Persian, written for the user), the same way
      // provider-panel/admin-panel's useApi does. This used to read ofetch's
      // `statusMessage`, which is the HTTP *reason phrase* -- so a 409 surfaced as the
      // English "Conflict" instead of the real explanation, and over HTTP/2 (no reason
      // phrases exist in the protocol) it surfaced as an empty toast.
      const fetchErr = err as {
        data?: { message?: unknown; code?: unknown }
        response?: { _data?: { message?: unknown; code?: unknown } }
        statusMessage?: string
      }
      const bodyMessage = fetchErr.data?.message ?? fetchErr.response?._data?.message
      const message =
        typeof bodyMessage === 'string' && bodyMessage.trim()
          ? bodyMessage
          : status === 0
            ? 'خطا در ارتباط با سرور'
            : 'خطایی رخ داد'
      const bodyCode = fetchErr.data?.code ?? fetchErr.response?._data?.code
      const apiError: ApiError = { status, message, code: typeof bodyCode === 'string' ? bodyCode : undefined }

      if (status === 401) {
        if (options.redirectOn401 !== false) {
          await navigateTo('/login')
        }
        return { data: null, error: apiError }
      }

      if (!options.silent) {
        useToast().push(message)
      }

      return { data: null, error: apiError }
    }
  }

  return { apiFetch }
}
