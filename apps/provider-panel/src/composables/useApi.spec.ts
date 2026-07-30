import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeApiMessage, useApi } from './useApi'
import { useToast } from './useToast'

describe('useApi', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns parsed JSON data on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '1' }),
    }))

    const { apiFetch } = useApi()
    const { data, error } = await apiFetch('/salons/mine')

    expect(data).toEqual({ id: '1' })
    expect(error).toBeNull()
  })

  it('redirects to /login on a 401 by default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    }))

    const { apiFetch } = useApi()
    await apiFetch('/salons/mine')

    expect(window.location.href).toBe('/login')
  })

  it('does not redirect on 401 when redirectOn401 is false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    }))

    const { apiFetch } = useApi()
    await apiFetch('/salons/mine', { redirectOn401: false })

    expect(window.location.href).toBe('')
  })

  it('sends FormData bodies without a Content-Type header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const form = new FormData()
    const { apiFetch } = useApi()
    await apiFetch('/salons/mine/photos', { method: 'POST', body: form })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: form, headers: undefined }),
    )
  })

  it('pushes a toast on a non-401 error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Server error' }),
    }))

    const { apiFetch } = useApi()
    const { toasts } = useToast()
    const before = toasts.value.length

    await apiFetch('/salons/mine')

    expect(toasts.value.length).toBe(before + 1)
    expect(toasts.value.at(-1)?.message).toBe('Server error')
  })

  // Nest's ValidationPipe answers a failed DTO check with `message: string[]` of English
  // sentences. Toasting that array raw rendered it as `[ "serviceId must be a UUID" ]` in a
  // Persian-only panel -- the one thing the provider saw when a client-side check was missed.
  it('replaces a 400 validation array with Persian copy instead of toasting English validator text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: ['durationMin must not be less than 5', 'name must be a string'] }),
    }))

    const { apiFetch } = useApi()
    const { toasts } = useToast()

    const { error } = await apiFetch('/salons/mine/services', { method: 'POST', body: {} })

    expect(error?.message).toBe('اطلاعات واردشده معتبر نیست. مقادیر فرم را بررسی کنید.')
    expect(toasts.value.at(-1)?.message).toBe('اطلاعات واردشده معتبر نیست. مقادیر فرم را بررسی کنید.')
    expect(toasts.value.at(-1)?.message).not.toContain('durationMin')
  })

  it('keeps surfacing a hand-thrown (already Persian) 400 message verbatim', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'کد تخفیف منقضی شده است' }),
    }))

    const { apiFetch } = useApi()
    const { error } = await apiFetch('/coupons/validate', { method: 'POST', body: {} })

    expect(error?.message).toBe('کد تخفیف منقضی شده است')
  })

  it('pushes a toast on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const { apiFetch } = useApi()
    const { toasts } = useToast()
    const before = toasts.value.length

    await apiFetch('/salons/mine')

    expect(toasts.value.length).toBe(before + 1)
    // Persian, like every other message this panel can show -- these two generic
    // fallbacks were the last English strings reachable by a toast here.
    expect(toasts.value.at(-1)?.message).toBe('خطا در ارتباط با سرور')
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
