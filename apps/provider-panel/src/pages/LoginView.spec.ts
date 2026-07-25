import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginView from './LoginView.vue'
import { useSessionStore } from '@/stores/session'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/', name: 'dashboard', component: { template: '<div />' } },
    ],
  })
}

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests an OTP then verifies it, landing on the dashboard', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) }) // request-otp
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ user: { id: 'u1', phone: '09120000000', name: 'Sara', gender: 'female', role: 'provider' } }),
      }) // verify-otp
    vi.stubGlobal('fetch', fetchMock)

    const router = makeRouter()
    await router.push('/login')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="phone-input"]').setValue('09120000000')
    await wrapper.find('[data-testid="phone-form"]').trigger('submit')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="code-input"]').exists()).toBe(true)

    await wrapper.find('[data-testid="code-input"]').setValue('1234')
    await wrapper.find('[data-testid="code-form"]').trigger('submit')
    await new Promise((r) => setTimeout(r, 0))
    await router.isReady()

    expect(useSessionStore().isLoggedIn).toBe(true)
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('shows an error and stays on the phone step when request-otp fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'bad phone' }) }))

    const router = makeRouter()
    await router.push('/login')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="phone-input"]').setValue('123')
    await wrapper.find('[data-testid="phone-form"]').trigger('submit')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="code-input"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('شماره موبایل نامعتبر است')
  })

  it('shows a network-problem message (not the invalid-input message) when the request fails offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const router = makeRouter()
    await router.push('/login')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="phone-input"]').setValue('09120000000')
    await wrapper.find('[data-testid="phone-form"]').trigger('submit')
    await new Promise((r) => setTimeout(r, 0))

    const errorEl = wrapper.find('[role="alert"]')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toContain('اتصال اینترنت برقرار نیست')
    expect(errorEl.text()).not.toContain('شماره موبایل نامعتبر است')
  })

  it('shows a rate-limit message (not the invalid-input message) on a 429 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ message: 'too many requests' }) }))

    const router = makeRouter()
    await router.push('/login')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="phone-input"]').setValue('09120000000')
    await wrapper.find('[data-testid="phone-form"]').trigger('submit')
    await new Promise((r) => setTimeout(r, 0))

    const errorEl = wrapper.find('[role="alert"]')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toContain('چند لحظه صبر کنید')
    expect(errorEl.text()).not.toContain('شماره موبایل نامعتبر است')
  })

  it('error message is announced via role="alert" for screen readers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'bad phone' }) }))

    const router = makeRouter()
    await router.push('/login')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="phone-input"]').setValue('123')
    await wrapper.find('[data-testid="phone-form"]').trigger('submit')
    await new Promise((r) => setTimeout(r, 0))

    const errorEl = wrapper.find('[role="alert"]')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.attributes('aria-live')).toBe('polite')
  })

  it('shows an error and stays on the code step when verify-otp fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) }) // request-otp succeeds
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: 'bad code' }) }) // verify-otp fails
    vi.stubGlobal('fetch', fetchMock)

    const router = makeRouter()
    await router.push('/login')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="phone-input"]').setValue('09120000000')
    await wrapper.find('[data-testid="phone-form"]').trigger('submit')
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="code-input"]').setValue('0000')
    await wrapper.find('[data-testid="code-form"]').trigger('submit')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="code-input"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('کد وارد شده اشتباه است')
    expect(useSessionStore().isLoggedIn).toBe(false)
  })

  it('shows a server-error message (not the wrong-code message) on the code step when verify-otp 5xxs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) }) // request-otp succeeds
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ message: 'unavailable' }) }) // verify-otp 5xxs
    vi.stubGlobal('fetch', fetchMock)

    const router = makeRouter()
    await router.push('/login')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="phone-input"]').setValue('09120000000')
    await wrapper.find('[data-testid="phone-form"]').trigger('submit')
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('[data-testid="code-input"]').setValue('0000')
    await wrapper.find('[data-testid="code-form"]').trigger('submit')
    await new Promise((r) => setTimeout(r, 0))

    const errorEl = wrapper.find('[role="alert"]')
    expect(errorEl.exists()).toBe(true)
    expect(errorEl.text()).toContain('خطایی در سرور رخ داده است')
    expect(errorEl.text()).not.toContain('کد وارد شده اشتباه است')
    expect(useSessionStore().isLoggedIn).toBe(false)
  })
})
