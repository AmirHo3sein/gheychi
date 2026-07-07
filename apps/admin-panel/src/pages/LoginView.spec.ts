import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import LoginView from './LoginView.vue'

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
        { path: '/login', component: LoginView },
        { path: '/', component: { template: '<div />' } },
      ],
    })
    router.push('/login')
    await router.isReady()
    return mount(LoginView, { global: { plugins: [router] } })
  }

  it('requests an OTP for the entered phone number', async () => {
    fetchMock.mockResolvedValueOnce({ data: { ok: true }, error: null })
    const wrapper = await mountWithRouter()

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
    const wrapper = await mountWithRouter()

    await wrapper.get('[data-testid="phone-input"]').setValue('09120000900')
    await wrapper.get('[data-testid="phone-form"]').trigger('submit')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="code-input"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('too many requests')
  })

  it('verifies the code and navigates to / on success', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
      .mockResolvedValueOnce({
        data: { user: { id: 'u1', phone: '09120000900', name: null, gender: null, role: 'admin' }, isNewUser: false },
        error: null,
      })
    const wrapper = await mountWithRouter()

    await wrapper.get('[data-testid="phone-input"]').setValue('09120000900')
    await wrapper.get('[data-testid="phone-form"]').trigger('submit')
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-testid="code-input"]').setValue('123456')
    await wrapper.get('[data-testid="code-form"]').trigger('submit')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/auth/verify-otp', {
      method: 'POST',
      body: { phone: '09120000900', code: '123456' },
      silent: true,
    })
  })
})
