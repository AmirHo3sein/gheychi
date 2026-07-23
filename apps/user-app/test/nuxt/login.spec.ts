import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import LoginPage from '../../app/pages/login.vue'

// Same pattern as booking-confirm.spec.ts / useApi.spec.ts: `$fetch` is a real
// globalThis binding, not an unimport-tracked auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

// Mutated per-test before mount so the ?ref= prefill test can control it -- same
// dynamic-read-per-call idiom as booking-detail.spec.ts's fixed params, but here the
// query needs to vary between tests in this file.
let routeQuery: Record<string, string> = {}
mockNuxtImport('useRoute', () => () => ({ query: routeQuery }))

const EXISTING_USER = { id: 'u1', phone: '09120000000', name: 'Existing', gender: 'male', role: 'customer' }
const NEW_USER_INCOMPLETE = { id: 'u2', phone: '09121111111', name: null, gender: null, role: 'customer' }

async function goToCodeStep(wrapper: Awaited<ReturnType<typeof mountSuspended>>, phone = '09120000000') {
  await wrapper.find('input[type="tel"]').setValue(phone)
  await wrapper.find('form').trigger('submit.prevent')
  await flushPromises()
}

describe('login page - referral code entry', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    routeQuery = {}
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the referral code field collapsed behind a toggle by default on the code step', async () => {
    fetchMock.mockResolvedValueOnce(undefined) // request-otp
    const wrapper = await mountSuspended(LoginPage)
    await goToCodeStep(wrapper)

    expect(wrapper.find('[data-testid="referral-code-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="show-referral-code"]').exists()).toBe(true)

    await wrapper.find('[data-testid="show-referral-code"]').trigger('click')
    expect(wrapper.find('[data-testid="referral-code-input"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="show-referral-code"]').exists()).toBe(false)
  })

  it('prefills and reveals the referral field from a ?ref= query param, matching the shareUrl shape', async () => {
    routeQuery = { ref: 'AB3D9F2K' }
    fetchMock.mockResolvedValueOnce(undefined) // request-otp
    const wrapper = await mountSuspended(LoginPage)
    await goToCodeStep(wrapper)

    const field = wrapper.find('[data-testid="referral-code-input"] input')
    expect(field.exists()).toBe(true)
    expect((field.element as HTMLInputElement).value).toBe('AB3D9F2K')
  })

  it('includes a trimmed referralCode in the verify-otp body when the field is filled in', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/auth/request-otp') return undefined
      if (path === '/auth/verify-otp') return { user: EXISTING_USER, isNewUser: false }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(LoginPage)
    await goToCodeStep(wrapper)

    await wrapper.find('[data-testid="show-referral-code"]').trigger('click')
    await wrapper.find('[data-testid="referral-code-input"] input').setValue('  AB3D9F2K  ')
    await wrapper.find('input[inputmode="numeric"]').setValue('123456')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/auth/verify-otp',
      expect.objectContaining({
        method: 'POST',
        body: { phone: '09120000000', code: '123456', referralCode: 'AB3D9F2K' },
      }),
    )
  })

  it('omits referralCode entirely from the request body when the field was never filled in', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/auth/request-otp') return undefined
      if (path === '/auth/verify-otp') return { user: EXISTING_USER, isNewUser: false }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(LoginPage)
    await goToCodeStep(wrapper)

    await wrapper.find('input[inputmode="numeric"]').setValue('123456')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/auth/verify-otp',
      expect.objectContaining({ body: { phone: '09120000000', code: '123456' } }),
    )
  })

  it('routes a fresh registration with an incomplete profile to the profile step, not home', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/auth/request-otp') return undefined
      if (path === '/auth/verify-otp') return { user: NEW_USER_INCOMPLETE, isNewUser: true, referralStatus: 'applied' }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(LoginPage)
    await goToCodeStep(wrapper, '09121111111')

    await wrapper.find('input[inputmode="numeric"]').setValue('123456')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(navigateToMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('چند قدم تا شروع')
  })

  it.each([
    ['applied', 'کد معرف با موفقیت ثبت شد'],
    ['invalid_code', 'کد معرف وارد شده معتبر نیست'],
    ['referral_type_disabled', 'کد معرف ثبت شد؛ پاداش‌های معرفی به‌زودی فعال می‌شود'],
  ] as const)('toasts the right message for referralStatus=%s', async (status, expectedMessage) => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/auth/request-otp') return undefined
      if (path === '/auth/verify-otp') return { user: EXISTING_USER, isNewUser: false, referralStatus: status }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(LoginPage)
    await goToCodeStep(wrapper)
    const { toasts } = useToast()
    const before = toasts.value.length

    await wrapper.find('input[inputmode="numeric"]').setValue('123456')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(toasts.value.length).toBe(before + 1)
    expect(toasts.value.at(-1)?.message).toBe(expectedMessage)
  })

  it('does not toast anything when the response omits referralStatus (existing account, per R2)', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/auth/request-otp') return undefined
      if (path === '/auth/verify-otp') return { user: EXISTING_USER, isNewUser: false }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(LoginPage)
    await goToCodeStep(wrapper)
    const { toasts } = useToast()
    const before = toasts.value.length

    await wrapper.find('input[inputmode="numeric"]').setValue('123456')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(toasts.value.length).toBe(before)
  })
})
