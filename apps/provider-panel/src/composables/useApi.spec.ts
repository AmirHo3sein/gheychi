import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApi } from './useApi'

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
})
