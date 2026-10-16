import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import DefaultLayout from '../../app/layouts/default.vue'
import { useSessionStore } from '../../app/stores/session'

// A fixed bottom bar must never cover the footer links: the layout (not the page, whose padding
// stops above the footer) reserves the bar's height under everything it renders.
describe('default layout bottom reservation', () => {
  it('reserves the tab bar height on tab-bar pages', async () => {
    const wrapper = await mountSuspended(DefaultLayout, { route: '/' })
    expect(wrapper.find('[data-testid="bottom-nav"]').exists()).toBe(true)
    expect(wrapper.get('.min-h-screen').classes()).toContain('pb-[calc(3.5rem+env(safe-area-inset-bottom))]')
  })

  it("reserves the salon page's sticky CTA bar height, under the footer too", async () => {
    const wrapper = await mountSuspended(DefaultLayout, { route: '/salons/some-salon' })
    expect(wrapper.find('[data-testid="bottom-nav"]').exists()).toBe(false)
    expect(wrapper.find('footer').exists()).toBe(true)
    expect(wrapper.get('.min-h-screen').classes()).toContain('pb-[calc(5rem+env(safe-area-inset-bottom))]')
    expect(wrapper.get('.min-h-screen').classes()).toContain('lg:pb-0')
  })

  it('reserves nothing at checkout, where the page pads above its own bar and there is no footer', async () => {
    // Checkout is auth-gated; without a session the global middleware would land on /login.
    useSessionStore().setUser({ id: 'u1', phone: '09120000000', name: 'Test', gender: 'female', role: 'customer' })
    const wrapper = await mountSuspended(DefaultLayout, { route: '/booking/some-salon/svc-1' })
    expect(useRoute().path).toBe('/booking/some-salon/svc-1')
    expect(wrapper.find('footer').exists()).toBe(false)
    expect(wrapper.get('.min-h-screen').classes().some((c) => c.startsWith('pb-'))).toBe(false)
  })
})
