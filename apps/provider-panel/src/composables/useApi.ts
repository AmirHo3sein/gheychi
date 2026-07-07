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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  silent?: boolean
  /** Set to false to suppress the automatic redirect-to-/login on a 401 (defaults to true). */
  redirectOn401?: boolean
}

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3002/api'

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
        let message = 'Something went wrong'
        try {
          message = (await res.json())?.message ?? message
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
      const apiError: ApiError = { status: 0, message: 'Network error' }
      if (!options.silent) useToast().push(apiError.message)
      return { data: null, error: apiError }
    }
  }

  return { apiFetch }
}
