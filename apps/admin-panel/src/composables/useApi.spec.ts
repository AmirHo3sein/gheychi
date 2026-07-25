import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetToast, useToast } from './useToast'
import { useApi } from './useApi'

describe('useApi', () => {
  const originalFetch = global.fetch
  const originalLocation = window.location

  beforeEach(() => {
    resetToast()
    global.fetch = vi.fn()
    // window.location has mismatched get/set accessor types in lib.dom.d.ts
    // (getter: Location, setter: string), so a direct `window.location = ...`
    // assignment doesn't typecheck under --strict no matter how the RHS is
    // cast. Object.defineProperty sidesteps it -- same approach as
    // provider-panel's useApi.spec.ts.
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, href: '' },
      writable: true,
    })
  })

  afterEach(() => {
    global.fetch = originalFetch
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    })
  })

  it('returns parsed JSON data on a 200 response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    const { apiFetch } = useApi()
    const { data, error } = await apiFetch<{ ok: boolean }>('/ping')
    expect(data).toEqual({ ok: true })
    expect(error).toBeNull()
  })

  it('returns null data with no body on a 204 response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    const { apiFetch } = useApi()
    const { data, error } = await apiFetch('/ping')
    expect(data).toBeNull()
    expect(error).toBeNull()
  })

  it('pushes a toast and returns an ApiError on a non-401 failure by default', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'bad request' }), { status: 400 }),
    )
    const { apiFetch } = useApi()
    const { data, error } = await apiFetch('/ping')
    expect(data).toBeNull()
    expect(error).toEqual({ status: 400, message: 'bad request' })
    expect(useToast().toasts.value).toHaveLength(1)
  })

  it('suppresses the toast when silent is true', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }))
    const { apiFetch } = useApi()
    await apiFetch('/ping', { silent: true })
    expect(useToast().toasts.value).toHaveLength(0)
  })

  it('redirects to /login on a 401 by default', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 401 }))
    const { apiFetch } = useApi()
    await apiFetch('/ping')
    expect(window.location.href).toBe('/login')
  })

  it('does not redirect on a 401 when redirectOn401 is false', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 401 }))
    const { apiFetch } = useApi()
    await apiFetch('/ping', { redirectOn401: false })
    expect(window.location.href).toBe('')
  })

  it('returns a network ApiError when fetch itself throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('boom'))
    const { apiFetch } = useApi()
    const { data, error } = await apiFetch('/ping')
    expect(data).toBeNull()
    expect(error).toEqual({ status: 0, message: 'خطا در ارتباط با سرور' })
  })
})
