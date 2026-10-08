import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/', fullPath: '/', meta: { title: 'داشبورد' } }),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/composables/useApi', () => ({ useApi: () => ({ apiFetch: vi.fn().mockResolvedValue({ data: { count: 0 }, error: null }) }) }))

const { default: AppLayout } = await import('./AppLayout.vue')

function mountLayout() {
  return mount(AppLayout, {
    attachTo: document.body,
    global: {
      stubs: { RouterLink: RouterLinkStub, RouterView: true },
    },
  })
}

describe('AppLayout phone navigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('names the icon-only header buttons', () => {
    const wrapper = mountLayout()
    expect(wrapper.find('button[aria-label="خروج"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="حالت تیره"], button[aria-label="حالت روشن"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('opens the drawer from the hamburger and exposes its state', async () => {
    const wrapper = mountLayout()
    const burger = wrapper.get('button[aria-label="منو"][aria-controls="mobile-nav-drawer"]')
    expect(burger.attributes('aria-expanded')).toBe('false')
    expect(burger.classes()).toContain('md:hidden')
    expect(wrapper.find('#mobile-nav-drawer').exists()).toBe(false)

    await burger.trigger('click')
    await flushPromises()
    expect(burger.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('#mobile-nav-drawer').exists()).toBe(true)

    await wrapper.get('[data-testid="mobile-nav-drawer"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('#mobile-nav-drawer').exists()).toBe(false)
    expect(document.activeElement).toBe(burger.element)
    wrapper.unmount()
  })

  it('keeps the full sidebar for md and up and hides it on phones', () => {
    const wrapper = mountLayout()
    const aside = wrapper.get('aside')
    expect(aside.classes()).toEqual(expect.arrayContaining(['hidden', 'md:block', 'w-64']))
    expect(aside.text()).toContain('داشبورد')
    wrapper.unmount()
  })
})
