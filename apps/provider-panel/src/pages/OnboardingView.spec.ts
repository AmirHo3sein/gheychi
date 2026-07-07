import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingView from './OnboardingView.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/onboarding', name: 'onboarding', component: OnboardingView },
      { path: '/pending-approval', name: 'pending-approval', component: { template: '<div />' } },
    ],
  })
}

describe('OnboardingView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the next button disabled until the salon-info step is complete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ([]) }))
    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    const next = wrapper.find('[data-testid="wizard-next"]')
    expect((next.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await wrapper.find('[data-testid="gender-target"]').setValue('women')
    await wrapper.find('[data-testid="city"]').setValue('تهران')
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    // The map pin picker doesn't run in jsdom/happy-dom (no real Neshan SDK) -- set the
    // coordinates directly the way the picker's @update:model-value handler would.
    await wrapper.setData({ form: { salonInfo: { lat: 35.7, lng: 51.4 } } })

    expect((next.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps the next button disabled when capacity is out of the 1-50 range', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ([]) }))
    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await wrapper.find('[data-testid="gender-target"]').setValue('women')
    await wrapper.find('[data-testid="city"]').setValue('تهران')
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    await wrapper.find('[data-testid="capacity"]').setValue(0)
    // The map pin picker doesn't run in jsdom/happy-dom (no real Neshan SDK) -- set the
    // coordinates directly the way the picker's @update:model-value handler would.
    await wrapper.setData({ form: { salonInfo: { lat: 35.7, lng: 51.4 } } })

    const next = wrapper.find('[data-testid="wizard-next"]')
    expect((next.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.find('[data-testid="capacity"]').setValue(5)
    expect((next.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('submits salon, hours, and first service in order, then lands on pending-approval', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([{ id: 1, name: 'رنگ مو' }]) }) // categories (mounted on step 3)
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 's1' }) }) // POST /salons
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ([]) }) // PUT hours
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'sv1' }) }) // POST services
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 's1', status: 'pending' }) }) // refetch salon
    vi.stubGlobal('fetch', fetchMock)

    const router = makeRouter()
    await router.push('/onboarding')
    await router.isReady()
    const wrapper = mount(OnboardingView, { global: { plugins: [router] } })

    await wrapper.find('[data-testid="salon-name"]').setValue('سالن سارا')
    await wrapper.find('[data-testid="gender-target"]').setValue('women')
    await wrapper.find('[data-testid="city"]').setValue('تهران')
    await wrapper.find('[data-testid="address"]').setValue('خیابان ولیعصر، پلاک ۱')
    await wrapper.setData({ form: { salonInfo: { lat: 35.7, lng: 51.4 } } })
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')

    await wrapper.find('[data-testid="day-0"] input[type=checkbox]').setValue(true)
    await wrapper.find('[data-testid="wizard-next"]').trigger('click')

    await wrapper.find('[data-testid="service-category"]').setValue('1')
    await wrapper.find('[data-testid="service-name"]').setValue('رنگ مو')
    await wrapper.find('[data-testid="service-price"]').setValue('500000')
    await wrapper.find('[data-testid="service-duration"]').setValue('60')
    await wrapper.find('[data-testid="wizard-submit"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await router.isReady()

    expect(fetchMock.mock.calls[1]![0]).toContain('/salons')
    expect(fetchMock.mock.calls[2]![0]).toContain('/salons/mine/hours')
    expect(fetchMock.mock.calls[3]![0]).toContain('/salons/mine/services')
    expect(router.currentRoute.value.name).toBe('pending-approval')
  })
})
