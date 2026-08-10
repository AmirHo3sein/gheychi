import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

// `$fetch` is exposed by Nuxt as a real `globalThis` binding (set up by a build-time
// plugin), not as an unimport-tracked auto-import -- so `mockNuxtImport` can't target
// it (it only knows about names in the live unimport registry, and errors with
// "Cannot find import ... to mock" for anything else). `vi.stubGlobal` is the
// documented way to stub it instead.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

// `mockNuxtImport` compiles to a hoisted `vi.mock` call, so the mock it returns must
// come from `vi.hoisted` -- a plain `const` here would be accessed before its
// initialization once vitest lifts the mock above this file's other statements.
const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

describe('useApi', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    // Re-stub before every test (and undo it in afterEach below) rather than stubbing
    // once at module scope, so this file doesn't rely on Vitest's default per-file
    // isolation to keep the global stub from leaking across tests/files.
    vi.stubGlobal('$fetch', fetchStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns { data } on success', async () => {
    fetchMock.mockResolvedValue({ id: '1' })
    const { apiFetch } = useApi()
    const result = await apiFetch('/salons/foo')
    expect(result).toEqual({ data: { id: '1' }, error: null })
  })

  it('in silent mode, returns the error instead of throwing or redirecting', async () => {
    fetchMock.mockRejectedValue({ response: { status: 409 }, statusMessage: 'Conflict' })
    const { apiFetch } = useApi()
    const result = await apiFetch('/bookings', { method: 'POST', silent: true })
    expect(result.data).toBeNull()
    expect(result.error?.status).toBe(409)
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('on a 401, redirects to /login even when not silent', async () => {
    fetchMock.mockRejectedValue({ response: { status: 401 } })
    const { apiFetch } = useApi()
    await apiFetch('/bookings/mine')
    expect(navigateToMock).toHaveBeenCalledWith('/login')
  })

  it('on a 401 with redirectOn401: false, does not redirect but still returns the error', async () => {
    fetchMock.mockRejectedValue({ response: { status: 401 } })
    const { apiFetch } = useApi()
    const result = await apiFetch('/auth/me', { silent: true, redirectOn401: false })
    expect(navigateToMock).not.toHaveBeenCalled()
    expect(result.data).toBeNull()
    expect(result.error?.status).toBe(401)
  })

  it('on a non-401 error without silent mode, pushes a toast and still returns the error', async () => {
    fetchMock.mockRejectedValue({ response: { status: 500 }, statusMessage: 'Server error' })
    const { apiFetch } = useApi()
    const { toasts } = useToast()
    const before = toasts.value.length
    const result = await apiFetch('/search')
    expect(toasts.value.length).toBe(before + 1)
    expect(result.error?.status).toBe(500)
  })

  it("surfaces the API's own message, not the HTTP reason phrase", async () => {
    // ofetch's `statusMessage` is the protocol reason phrase ('Conflict'), not the API's
    // Persian explanation -- and HTTP/2 has no reason phrases at all, so relying on it meant
    // an English toast in dev and a blank one in production.
    fetchMock.mockRejectedValue({
      response: { status: 409 },
      statusMessage: 'Conflict',
      data: { message: 'این بازه زمانی دیگر آزاد نیست' },
    })
    const { apiFetch } = useApi()
    const result = await apiFetch('/bookings', { method: 'POST', silent: true })
    expect(result.error?.message).toBe('این بازه زمانی دیگر آزاد نیست')
    expect(result.error?.message).not.toContain('Conflict')
  })

  it("reads the message off response._data when ofetch exposes it there instead", async () => {
    fetchMock.mockRejectedValue({
      response: { status: 400, _data: { message: 'کد تخفیف منقضی شده است' } },
      statusMessage: 'Bad Request',
    })
    const { apiFetch } = useApi()
    const result = await apiFetch('/coupons/validate', { method: 'POST', silent: true })
    expect(result.error?.message).toBe('کد تخفیف منقضی شده است')
  })

  it('surfaces a structured code off data.code alongside the message, when the API sends one', async () => {
    fetchMock.mockRejectedValue({
      response: { status: 400 },
      statusMessage: 'Bad Request',
      data: { message: 'کد تخفیف منقضی شده است', code: 'COUPON_EXPIRED' },
    })
    const { apiFetch } = useApi()
    const result = await apiFetch('/coupons/validate', { method: 'POST', silent: true })
    expect(result.error?.code).toBe('COUPON_EXPIRED')
  })

  it('reads the code off response._data too, same as the message fallback', async () => {
    fetchMock.mockRejectedValue({
      response: { status: 400, _data: { message: 'کد تخفیف نامعتبر است', code: 'COUPON_INVALID' } },
      statusMessage: 'Bad Request',
    })
    const { apiFetch } = useApi()
    const result = await apiFetch('/coupons/validate', { method: 'POST', silent: true })
    expect(result.error?.code).toBe('COUPON_INVALID')
  })

  it('leaves code undefined when the response body carries none', async () => {
    fetchMock.mockRejectedValue({
      response: { status: 400 },
      statusMessage: 'Bad Request',
      data: { message: 'این بازه زمانی دیگر آزاد نیست' },
    })
    const { apiFetch } = useApi()
    const result = await apiFetch('/bookings', { method: 'POST', silent: true })
    expect(result.error?.code).toBeUndefined()
  })

  it('falls back to Persian copy -- never an English phrase -- when the body carries no message', async () => {
    fetchMock.mockRejectedValue({ response: { status: 500 }, statusMessage: 'Internal Server Error' })
    const { apiFetch } = useApi()
    const result = await apiFetch('/search', { silent: true })
    expect(result.error?.message).not.toMatch(/[A-Za-z]{4,}/)
  })

  it('names a dead network distinctly from a server fault', async () => {
    // status 0 is this composable's "no HTTP response at all" marker.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { apiFetch } = useApi()
    const result = await apiFetch('/search', { silent: true })
    expect(result.error?.status).toBe(0)
    expect(result.error?.message).toContain('ارتباط')
  })
})
