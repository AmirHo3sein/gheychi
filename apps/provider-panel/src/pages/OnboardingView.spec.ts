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
})
