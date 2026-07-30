import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import ProfilePage from '../../app/pages/profile.vue'
import { useSessionStore } from '../../app/stores/session'

// Same pattern as login.spec.ts / account-wallet.spec.ts: `$fetch` is a real globalThis
// binding, not an unimport-tracked auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const USER = { id: 'u1', phone: '09120000000', name: 'Existing Name', gender: 'male' as const, role: 'customer' as const }

// Dispatch by URL -- the page fetches /favorites on mount, and hits /auth/profile /
// /auth/logout from user actions.
function stub(overrides: Record<string, unknown> = {}) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/favorites') return []
    if (path === '/auth/profile') return { ...USER, ...overrides }
    if (path === '/auth/logout') return undefined
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

// usePushSubscription's `supported` detection runs in its own onMounted and reads
// happy-dom's `navigator` -- which has no `serviceWorker`/`PushManager` by default --
// so the push-toggle section stays absent for every test that doesn't opt in via
// stubSupportedBrowser(), same idiom as usePushSubscription.spec.ts.
function stubSupportedBrowser(subscribed: boolean) {
  const getSubscription = vi.fn().mockResolvedValue(subscribed ? { endpoint: 'https://push.example/abc' } : null)
  const registration = { pushManager: { subscribe: vi.fn(), getSubscription } }
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve(registration) },
    configurable: true,
  })
  vi.stubGlobal('PushManager', class {})
}

describe('profile page', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    useSessionStore().$reset()
    useSessionStore().setUser(USER)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    // @ts-expect-error -- test-only cleanup of a property defined directly on navigator
    delete navigator.serviceWorker
  })

  it('renders the name and gender fields with real accessible labels via BaseInput/BaseSelect', async () => {
    stub()
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()

    const nameInput = wrapper.find('input[type="text"]')
    const nameLabel = wrapper.findAll('label').find((l) => l.text() === 'نام')
    expect(nameLabel).toBeTruthy()
    expect(nameLabel!.attributes('for')).toBe(nameInput.attributes('id'))

    const genderSelect = wrapper.find('select')
    const genderLabel = wrapper.findAll('label').find((l) => l.text() === 'جنسیت')
    expect(genderLabel).toBeTruthy()
    expect(genderLabel!.attributes('for')).toBe(genderSelect.attributes('id'))
  })

  it('shows a Persian inline error and never calls the API when the name is too short', async () => {
    stub()
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()
    fetchMock.mockClear()

    await wrapper.find('input[type="text"]').setValue('a')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).toContain('نام باید بین ۲ تا ۱۰۰ نویسه باشد')
    expect(fetchMock).not.toHaveBeenCalledWith('/auth/profile', expect.anything())
  })

  it('clears the inline name error once the user edits the field again', async () => {
    stub()
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()

    await wrapper.find('input[type="text"]').setValue('a')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()
    expect(wrapper.text()).toContain('نام باید بین ۲ تا ۱۰۰ نویسه باشد')

    await wrapper.find('input[type="text"]').setValue('ab')
    await flushPromises()
    expect(wrapper.text()).not.toContain('نام باید بین ۲ تا ۱۰۰ نویسه باشد')
  })

  it('saves the profile, updates the session, and pushes a success toast', async () => {
    stub({ name: 'New Name' })
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()
    const { toasts } = useToast()
    const before = toasts.value.length

    await wrapper.find('input[type="text"]').setValue('New Name')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/auth/profile',
      expect.objectContaining({ method: 'PATCH', body: { name: 'New Name', gender: 'male' } }),
    )
    expect(useSessionStore().user?.name).toBe('New Name')
    expect(toasts.value.length).toBe(before + 1)
    expect(toasts.value.at(-1)?.message).toBe('تغییرات ذخیره شد')
  })

  it('does not toast or update the session when the save fails', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/favorites') return []
      if (path === '/auth/profile') throw { response: { status: 500 }, statusMessage: 'Server error' }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()
    const { toasts } = useToast()
    const before = toasts.value.length

    await wrapper.find('input[type="text"]').setValue('New Name')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(useSessionStore().user?.name).toBe('Existing Name')
    // apiFetch itself toasts the generic server error (not silent), but the page's own
    // success toast must not additionally fire. The mock supplies only a `statusMessage`
    // (the HTTP reason phrase) and no body `message`, so apiFetch correctly falls back to
    // its own Persian copy rather than surfacing the English phrase.
    expect(toasts.value.length).toBe(before + 1)
    expect(toasts.value.at(-1)?.message).toBe('خطایی رخ داد')
  })

  it('renders the sign-out control with danger styling, not the reserved ad/sponsorship color', async () => {
    stub()
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()

    const logoutButton = wrapper.findAll('button').find((b) => b.text() === 'خروج از حساب')
    expect(logoutButton).toBeTruthy()
    expect(logoutButton!.classes().join(' ')).toContain('--color-danger-strong')
    expect(logoutButton!.classes().join(' ')).not.toContain('--color-ad')

    await logoutButton!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/auth/logout', expect.objectContaining({ method: 'POST' }))
    expect(useSessionStore().user).toBeNull()
    expect(navigateToMock).toHaveBeenCalledWith('/login')
  })

  it('exposes aria-pressed on the push toggle, matching the current subscription state', async () => {
    stub()
    stubSupportedBrowser(true)
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()

    const toggle = wrapper.find('button[aria-pressed]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-pressed')).toBe('true')
  })

  it('reflects an inactive push subscription via aria-pressed="false"', async () => {
    stub()
    stubSupportedBrowser(false)
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()

    const toggle = wrapper.find('button[aria-pressed]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-pressed')).toBe('false')
  })
})
