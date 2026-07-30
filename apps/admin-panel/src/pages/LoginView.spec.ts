import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import LoginView from './LoginView.vue'
import { useSessionStore } from '@/stores/session'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
  })

  async function mountWithRouter() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView },
        { path: '/', name: 'dashboard', component: { template: '<div />' } },
      ],
    })
    router.push('/login')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [router] } })
    return { wrapper, router }
  }

  it('requests an OTP for the entered phone number', async () => {
    fetchMock.mockResolvedValueOnce({ data: { ok: true }, error: null })
    const { wrapper } = await mountWithRouter()

    await wrapper.get('[data-testid="phone-input"]').setValue('09120000900')
    // happy-dom doesn't implement the browser's implicit "clicking a submit
    // button submits its form" behavior, so a plain button click never fires
    // the form's `submit` event here. Trigger `submit` on the form directly
    // instead -- same approach as provider-panel's LoginView.spec.ts.
    await wrapper.get('[data-testid="phone-form"]').trigger('submit')
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/auth/request-otp', {
      method: 'POST',
      body: { phone: '09120000900' },
      silent: true,
    })
    expect(wrapper.find('[data-testid="code-input"]').exists()).toBe(true)
  })

  it('shows an inline error and does not advance when the OTP request fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 429, message: 'too many requests' } })
    const { wrapper } = await mountWithRouter()

    await wrapper.get('[data-testid="phone-input"]').setValue('09120000900')
    await wrapper.get('[data-testid="phone-form"]').trigger('submit')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="code-input"]').exists()).toBe(false)
    // The API's own message is English ('too many requests'); this screen must never render
    // it verbatim, and a 429 has to name the real hour-long window it just hit.
    expect(wrapper.text()).not.toContain('too many requests')
    expect(wrapper.text()).toContain('تا یک ساعت آینده')
  })

  it('verifies the code and navigates to / on success', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
      .mockResolvedValueOnce({
        data: { user: { id: 'u1', phone: '09120000900', name: null, gender: null, role: 'admin' }, isNewUser: false },
        error: null,
      })
    const { wrapper, router } = await mountWithRouter()

    await wrapper.get('[data-testid="phone-input"]').setValue('09120000900')
    await wrapper.get('[data-testid="phone-form"]').trigger('submit')
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-testid="code-input"]').setValue('123456')
    await wrapper.get('[data-testid="code-form"]').trigger('submit')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))
    await router.isReady()

    expect(fetchMock).toHaveBeenCalledWith('/auth/verify-otp', {
      method: 'POST',
      body: { phone: '09120000900', code: '123456' },
      silent: true,
    })
    expect(useSessionStore().isLoggedIn).toBe(true)
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('shows an error and stays on the code step when verify-otp fails', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
      .mockResolvedValueOnce({ data: null, error: { status: 401, message: 'Invalid or expired code' } })
    const { wrapper, router } = await mountWithRouter()

    await wrapper.get('[data-testid="phone-input"]').setValue('09120000900')
    await wrapper.get('[data-testid="phone-form"]').trigger('submit')
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-testid="code-input"]').setValue('000000')
    await wrapper.get('[data-testid="code-form"]').trigger('submit')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="code-input"]').exists()).toBe(true)
    // 401 covers wrong / expired / burned-by-retries alike, so the copy names both causes.
    expect(wrapper.text()).not.toContain('Invalid or expired code')
    expect(wrapper.text()).toContain('نادرست یا منقضی شده است')
    expect(useSessionStore().isLoggedIn).toBe(false)
    expect(router.currentRoute.value.name).toBe('login')
  })
})
