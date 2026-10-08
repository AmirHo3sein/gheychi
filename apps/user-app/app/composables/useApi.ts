import { customerFacingApiMessage, persianServerMessage } from '../utils/api-error-message'
import { loginLocation } from '../utils/safe-redirect'

export interface ApiError {
  /** 0 means a network/DNS/timeout failure with no HTTP response at all, not a real status code */
  status: number
  /**
   * Always Persian and safe to show a customer: the server's own message when it is Persian,
   * otherwise a status-based fallback (see utils/api-error-message.ts).
   */
  message: string
  /**
   * The server's own message, only when it is Persian (i.e. written for the customer).
   * Undefined when the server sent English/none. For callers that must tell "the API gave a
   * real reason" apart from the generic status-based `message` fallback.
   */
  serverMessage?: string
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
  /** Abort the request after this many ms (surfaces as a status-0 error). For callers on the SSR critical path that must never hang a page render. */
  timeoutMs?: number
}

export function useApi() {
  const config = useRuntimeConfig()
  // Captured at setup time: nuxt context is gone after the first await. useRouter (not
  // useRoute) because useRoute warns when reached through route middleware.
  let router: ReturnType<typeof useRouter> | null = null
  try {
    router = useRouter()
  } catch {
    router = null
  }

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
        timeout: options.timeoutMs,
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
      const message = customerFacingApiMessage(status, bodyMessage)
      const bodyCode = fetchErr.data?.code ?? fetchErr.response?._data?.code
      const apiError: ApiError = {
        status,
        message,
        serverMessage: persianServerMessage(bodyMessage) ?? undefined,
        code: typeof bodyCode === 'string' ? bodyCode : undefined,
      }

      if (status === 401) {
        if (options.redirectOn401 !== false) {
          await navigateTo(loginLocation(router?.currentRoute.value.fullPath))
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
