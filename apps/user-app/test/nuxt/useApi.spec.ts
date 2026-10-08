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

// useApi reads the router's current route (not useRoute -- that warns inside middleware) to
// remember where a 401 interrupted the customer.
const { currentFullPath } = vi.hoisted(() => ({ currentFullPath: { value: '/' } }))
mockNuxtImport('useRouter', () => () => ({ currentRoute: { get value() { return { fullPath: currentFullPath.value } } } }))

describe('useApi', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    currentFullPath.value = '/'
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

  // A caller on the SSR critical path (the home page's first search) must be able to bound the wait so a slow
  // API can never hold a page render hostage; ofetch surfaces the abort as a status-0 error.
  it('forwards timeoutMs to $fetch as its timeout, and reports a timed-out request as a status-0 error', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'))
    const { apiFetch } = useApi()

    const result = await apiFetch('/search', { silent: true, timeoutMs: 3000 })

    expect(fetchMock).toHaveBeenCalledWith('/search', expect.objectContaining({ timeout: 3000 }))
    expect(result.data).toBeNull()
    expect(result.error?.status).toBe(0)
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

  it('on a 401, remembers the current page (with its query) in ?redirect=', async () => {
    currentFullPath.value = '/bookings/abc?tab=1'
    fetchMock.mockRejectedValue({ response: { status: 401 } })
    const { apiFetch } = useApi()
    await apiFetch('/bookings/abc')
    expect(navigateToMock).toHaveBeenCalledWith('/login?redirect=' + encodeURIComponent('/bookings/abc?tab=1'))
  })

  it('on a 401 raised while already on /login, does not nest a redirect to itself', async () => {
    currentFullPath.value = '/login?redirect=%2Fbookings'
    fetchMock.mockRejectedValue({ response: { status: 401 } })
    const { apiFetch } = useApi()
    await apiFetch('/anything')
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
    expect(result.error?.message).toBe('اتصال برقرار نشد؛ اینترنت خود را بررسی کنید')
  })

  describe('customer-facing error messages', () => {
    async function failWith(status: number, data?: unknown, silent = true) {
      fetchMock.mockRejectedValue({ response: { status }, ...(data !== undefined ? { data } : {}) })
      const { apiFetch } = useApi()
      return apiFetch('/x', { silent })
    }

    it.each([
      [400, 'اطلاعات واردشده معتبر نیست'],
      [403, 'اجازه انجام این کار را ندارید'],
      [404, 'مورد درخواستی پیدا نشد'],
      [409, 'وضعیت این مورد تغییر کرده است؛ صفحه را تازه کنید و دوباره تلاش کنید'],
      [429, 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید'],
      [500, 'مشکلی پیش آمد؛ لطفاً دوباره تلاش کنید'],
      [503, 'مشکلی پیش آمد؛ لطفاً دوباره تلاش کنید'],
    ])('replaces an English server message on a %i with Persian copy', async (status, expected) => {
      const result = await failWith(status, { message: 'Booking cannot be cancelled in its current state' })
      expect(result.error?.message).toBe(expected)
      expect(result.error?.status).toBe(status)
    })

    it('shows the Persian fallback in the toast, never the English server message', async () => {
      const { toasts } = useToast()
      const before = toasts.value.length
      await failWith(409, { message: 'Booking cannot be cancelled in its current state' }, false)
      expect(toasts.value.length).toBe(before + 1)
      const last = toasts.value[toasts.value.length - 1]!
      expect(last.message).toBe('وضعیت این مورد تغییر کرده است؛ صفحه را تازه کنید و دوباره تلاش کنید')
      expect(last.message).not.toContain('Booking')
    })

    it('passes a Persian server message through unchanged, whatever the status', async () => {
      const result = await failWith(409, { message: 'این بازه زمانی دیگر آزاد نیست' })
      expect(result.error?.message).toBe('این بازه زمانی دیگر آزاد نیست')
    })

    it('treats a message mixing Persian with Latin text as Persian (passes through)', async () => {
      const result = await failWith(400, { message: 'کد SMS نامعتبر است' })
      expect(result.error?.message).toBe('کد SMS نامعتبر است')
    })

    it("falls back for class-validator's all-English string[] bodies", async () => {
      const result = await failWith(400, { message: ['startsAt must be a valid ISO 8601 date string'] })
      expect(result.error?.message).toBe('اطلاعات واردشده معتبر نیست')
    })

    it('uses the Persian entries of a mixed string[] body', async () => {
      const result = await failWith(400, { message: ['startsAt must be a date', 'نام الزامی است'] })
      expect(result.error?.message).toBe('نام الزامی است')
    })

    it('treats an empty/whitespace message as missing', async () => {
      const result = await failWith(404, { message: '   ' })
      expect(result.error?.message).toBe('مورد درخواستی پیدا نشد')
    })

    it('uses the network copy for status 0 even when a stray English message is present', async () => {
      fetchMock.mockRejectedValue({ data: { message: 'fetch failed' } })
      const { apiFetch } = useApi()
      const result = await apiFetch('/x', { silent: true })
      expect(result.error?.message).toBe('اتصال برقرار نشد؛ اینترنت خود را بررسی کنید')
    })

    it('keeps the machine-readable code regardless of the message rewrite', async () => {
      const result = await failWith(400, { message: 'Coupon expired', code: 'COUPON_EXPIRED' })
      expect(result.error?.code).toBe('COUPON_EXPIRED')
    })
  })
})
