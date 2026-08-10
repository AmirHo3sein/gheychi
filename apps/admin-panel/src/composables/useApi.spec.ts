import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetToast, useToast } from './useToast'
import { normalizeApiMessage, useApi } from './useApi'

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

  // Nest's ValidationPipe answers a failed DTO check with `message: string[]` of English
  // sentences. Toasting that array raw rendered it as `[ "serviceId must be a UUID" ]` in a
  // Persian-only panel -- the one thing an admin saw when a client-side check was missed.
  it('replaces a 400 validation array with Persian copy instead of toasting English validator text', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ message: ['durationMin must not be less than 5', 'name must be a string'] }),
        { status: 400 },
      ),
    )
    const { apiFetch } = useApi()
    const { error } = await apiFetch('/services', { method: 'POST', body: {} })

    expect(error?.message).toBe('اطلاعات واردشده معتبر نیست. مقادیر فرم را بررسی کنید.')
    expect(useToast().toasts.value.at(-1)?.message).toBe('اطلاعات واردشده معتبر نیست. مقادیر فرم را بررسی کنید.')
    expect(useToast().toasts.value.at(-1)?.message).not.toContain('durationMin')
  })

  it('keeps surfacing a hand-thrown (already Persian) 400 message verbatim', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'کد تخفیف منقضی شده است' }), { status: 400 }),
    )
    const { apiFetch } = useApi()
    const { error } = await apiFetch('/coupons/validate', { method: 'POST', body: {} })

    expect(error?.message).toBe('کد تخفیف منقضی شده است')
  })
})

describe('normalizeApiMessage', () => {
  it('maps any 400 array to the Persian validation fallback', () => {
    expect(normalizeApiMessage(400, ['a must be a UUID'])).toBe('اطلاعات واردشده معتبر نیست. مقادیر فرم را بررسی کنید.')
    expect(normalizeApiMessage(400, [])).toBe('اطلاعات واردشده معتبر نیست. مقادیر فرم را بررسی کنید.')
  })

  it('joins an array on any other status rather than letting it render as [ "…" ]', () => {
    expect(normalizeApiMessage(422, ['یک', 'دو'])).toBe('یک؛ دو')
  })

  it('returns null for a missing or empty message so the caller keeps its own default', () => {
    expect(normalizeApiMessage(500, undefined)).toBeNull()
    expect(normalizeApiMessage(500, '')).toBeNull()
    expect(normalizeApiMessage(500, { nested: true })).toBeNull()
  })
})
