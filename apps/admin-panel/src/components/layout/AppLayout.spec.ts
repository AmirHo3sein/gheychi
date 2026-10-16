import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/', fullPath: '/', meta: { title: 'داشبورد' } }),
  useRouter: () => ({ push: vi.fn() }),
}))
const apiFetch = vi.fn()
vi.mock('@/composables/useApi', () => ({ useApi: () => ({ apiFetch }) }))

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
    apiFetch.mockReset()
    apiFetch.mockResolvedValue({ data: { count: 0 }, error: null })
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

describe('AppLayout account menu and alert banner', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiFetch.mockReset()
    apiFetch.mockResolvedValue({ data: { count: 0 }, error: null })
  })

  it('folds theme and logout into an avatar menu that opens, closes on Escape and returns focus', async () => {
    const wrapper = mountLayout()
    const trigger = wrapper.get('[data-testid="account-menu-button"]')
    expect(trigger.attributes('aria-haspopup')).toBe('menu')
    expect(trigger.attributes('aria-expanded')).toBe('false')

    await trigger.trigger('click')
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    const items = wrapper.findAll('[role="menuitem"]')
    expect(items.map((i) => i.attributes('aria-label'))).toEqual([expect.stringMatching(/^حالت (تیره|روشن)$/), 'خروج'])
    expect(document.activeElement).toBe(items[0]!.element)

    await wrapper.get('[role="menu"]').trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1]!.element)

    await wrapper.get('[role="menu"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger.element)
    wrapper.unmount()
  })

  it('shows a person glyph, not phone digits, when the admin has no name', async () => {
    const { useSessionStore } = await import('@/stores/session')
    useSessionStore().setUser({ id: 'u1', phone: '09120000001', name: null, gender: null, role: 'admin' })
    const wrapper = mountLayout()
    expect(wrapper.get('[data-testid="account-menu-button"]').text()).not.toContain('01')
    wrapper.unmount()
  })

  // The banner reads the API's exact per-severity unread breakdown, not a page of rows.
  function mockUnreadCounts(counts: { total: number; critical: number; warning: number; info: number } | null) {
    apiFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/admin/notifications/unread-counts'
          ? counts
            ? { data: counts, error: null }
            : { data: null, error: { statusCode: 500 } }
          : { data: { count: counts?.total ?? 0 }, error: null },
      ),
    )
  }

  it('shows the critical-alert banner with the exact unread critical count', async () => {
    mockUnreadCounts({ total: 180, critical: 120, warning: 40, info: 20 })
    const wrapper = mountLayout()
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/admin/notifications/unread-counts', { silent: true })
    // No list page is fetched for the banner any more.
    expect(apiFetch.mock.calls.some(([url]) => String(url).startsWith('/admin/notifications?unread=true'))).toBe(false)
    const banner = wrapper.get('[data-testid="critical-alert-banner"]')
    // Exact, and never a "N+" lower bound however many rows are unread.
    expect(banner.text()).toContain('۱۲۰ هشدار بحرانی')
    expect(banner.text()).not.toContain('+')
    expect(wrapper.getComponent<typeof RouterLinkStub>('[data-testid="critical-alert-open"]').props('to')).toBe('/notifications?severity=critical&unread=true')
    wrapper.unmount()
  })

  // Warnings (including pre-column alerts, which the API counts as warnings) and info rows
  // never hold the critical banner up.
  it('does not show the banner when only warnings and info are unread', async () => {
    mockUnreadCounts({ total: 3, critical: 0, warning: 2, info: 1 })
    const wrapper = mountLayout()
    await flushPromises()
    expect(wrapper.find('[data-testid="critical-alert-banner"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('refreshes the banner when another surface announces a mark-read', async () => {
    mockUnreadCounts({ total: 2, critical: 2, warning: 0, info: 0 })
    const wrapper = mountLayout()
    await flushPromises()
    expect(wrapper.find('[data-testid="critical-alert-banner"]').exists()).toBe(true)

    mockUnreadCounts({ total: 0, critical: 0, warning: 0, info: 0 })
    const { announceNotificationsChanged } = await import('@/utils/notifications')
    announceNotificationsChanged()
    await flushPromises()
    expect(wrapper.find('[data-testid="critical-alert-banner"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the last known banner state when a poll fails', async () => {
    vi.useFakeTimers()
    try {
      mockUnreadCounts({ total: 1, critical: 1, warning: 0, info: 0 })
      const wrapper = mountLayout()
      await flushPromises()
      expect(wrapper.find('[data-testid="critical-alert-banner"]').exists()).toBe(true)

      mockUnreadCounts(null)
      await vi.advanceTimersByTimeAsync(60_000)
      await flushPromises()
      expect(apiFetch).toHaveBeenCalledWith('/admin/notifications/unread-counts', { silent: true })
      expect(wrapper.find('[data-testid="critical-alert-banner"]').exists()).toBe(true)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
