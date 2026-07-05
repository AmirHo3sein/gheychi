export interface ApiError {
  status: number
  message: string
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
      const data = await $fetch<T>(path, {
        baseURL: config.public.apiBase,
        method: options.method ?? 'GET',
        body: options.body,
        query: options.query,
        credentials: 'include',
        headers,
      })
      return { data, error: null }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status ?? 0
      const message = (err as { statusMessage?: string })?.statusMessage ?? 'Something went wrong'
      const apiError: ApiError = { status, message }

      if (status === 401) {
        await navigateTo('/login')
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
