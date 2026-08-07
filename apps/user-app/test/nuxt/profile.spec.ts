import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import Multiselect from 'vue-multiselect'
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

// Dispatch by URL -- the page hits /auth/profile / /auth/logout from user actions.
// /push/subscribe only shows up once a test opts into a push-capable browser:
// refreshStatus rebinds the endpoint to the current user (POST) and logout unbinds it
// (DELETE). Saved salons are no longer fetched here at all -- see the "links out to
// /account/favorites" test below -- so there is no /favorites branch to stub.
function stub(overrides: Record<string, unknown> = {}) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/auth/profile') return { ...USER, ...overrides }
    if (path === '/auth/logout') return undefined
    if (path === '/push/subscribe') return { ok: true }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

// usePushSubscription's `supported` detection runs in its own onMounted and reads
// happy-dom's `navigator` -- which has no `serviceWorker`/`PushManager` by default --
// so the push-toggle section stays absent for every test that doesn't opt in via
// stubSupportedBrowser(), same idiom as usePushSubscription.spec.ts.
function stubSupportedBrowser(subscribed: boolean) {
  const browserUnsubscribe = vi.fn().mockResolvedValue(true)
  const subscription = {
    endpoint: 'https://push.example/abc',
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: browserUnsubscribe,
  }
  const getSubscription = vi.fn().mockResolvedValue(subscribed ? subscription : null)
  const registration = { pushManager: { subscribe: vi.fn(), getSubscription } }
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve(registration) },
    configurable: true,
  })
  vi.stubGlobal('PushManager', class {})
  return { browserUnsubscribe }
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

  it('renders the name and gender fields with real accessible labels via BaseInput/AppSelect', async () => {
    stub()
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()

    const nameInput = wrapper.find('input[type="text"]')
    const nameLabel = wrapper.findAll('label').find((l) => l.text() === 'نام')
    expect(nameLabel).toBeTruthy()
    expect(nameLabel!.attributes('for')).toBe(nameInput.attributes('id'))

    // AppSelect's root is vue-multiselect's role="combobox" div, which a native <label for>
    // cannot target, so the association is aria-labelledby pointing back at the label.
    const genderCombobox = wrapper.find('[role="combobox"]')
    const genderLabel = wrapper.findAll('label').find((l) => l.text() === 'جنسیت')
    expect(genderLabel).toBeTruthy()
    expect(genderCombobox.attributes('aria-labelledby')).toBe(genderLabel!.attributes('id'))
  })

  it('leaves an unset gender visibly unset instead of pre-answering it as female', async () => {
    // Pre-selecting a value made the field look answered while the account still had
    // gender = null server-side -- and this field decides which salons the user is shown
    // at all, so it must never be filled in on the user's behalf.
    useSessionStore().setUser({ ...USER, name: null, gender: null })
    stub()
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()

    // Same lookup rationale as index.spec.ts: vue-multiselect's own component is the stable
    // reference through AppSelect's .client.vue wrapping. A null model-value means '' matched
    // no option, which is exactly what "nothing picked" has to look like -- and it renders as
    // the placeholder rather than as one of the two real choices.
    expect(wrapper.findComponent(Multiselect).props('modelValue')).toBeNull()
    expect(wrapper.find('.multiselect__placeholder').text()).toBe('انتخاب کنید')
  })

  it('refuses to save while the gender is unset, with a Persian inline error and no API call', async () => {
    useSessionStore().setUser({ ...USER, gender: null })
    stub()
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()
    fetchMock.mockClear()

    await wrapper.find('input[type="text"]').setValue('Valid Name')
    await wrapper.find('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).toContain('جنسیت را انتخاب کنید')
    expect(fetchMock).not.toHaveBeenCalledWith('/auth/profile', expect.anything())
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

  it('links out to /account/favorites instead of listing saved salons inline', async () => {
    // Saved salons used to be fetched and rendered directly on this page -- moved to its
    // own route (a dedicated card feed, matching /account/wallet and /account/referral's
    // established "profile links out, the sub-page does the fetching" pattern) so a saved
    // salon has a real place to be discovered, not just a plain-text row buried here.
    stub()
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalledWith('/favorites', expect.anything())
    const favoritesLink = wrapper
      .findAllComponents({ name: 'NuxtLink' })
      .find((link) => link.props('to') === '/account/favorites')
    expect(favoritesLink).toBeTruthy()
    expect(favoritesLink!.text()).toContain('مشاهده سالن‌های ذخیره‌شده')
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

  it('unbinds this browser push subscription before clearing the session on logout', async () => {
    // DELETE /push/subscribe is scoped to { endpoint, userId }, so it only works while the
    // session cookie is still present. Without this, the row stayed owned by the user who
    // logged out and the next person on a shared device kept receiving their appointment
    // notifications while their own toggle-off deleted nothing.
    stub()
    const { browserUnsubscribe } = stubSupportedBrowser(true)
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'خروج از حساب')!.trigger('click')
    await flushPromises()

    const paths = fetchMock.mock.calls.map((c) => `${c[0]} ${(c[1] as { method?: string })?.method ?? 'GET'}`)
    expect(paths).toContain('/push/subscribe DELETE')
    expect(paths.indexOf('/push/subscribe DELETE')).toBeLessThan(paths.indexOf('/auth/logout POST'))
    expect(browserUnsubscribe).toHaveBeenCalledTimes(1)
    expect(useSessionStore().user).toBeNull()
    expect(navigateToMock).toHaveBeenCalledWith('/login')
  })

  it('still logs the user out when the push unbind fails', async () => {
    // A user must always be able to leave -- a dead service worker or a failing DELETE
    // cannot be allowed to trap them in the session.
    const { browserUnsubscribe } = stubSupportedBrowser(true)
    browserUnsubscribe.mockRejectedValue(new Error('service worker gone'))
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/push/subscribe') throw { response: { status: 500 }, statusMessage: 'Server error' }
      if (path === '/auth/logout') return undefined
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(ProfilePage)
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === 'خروج از حساب')!.trigger('click')
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
