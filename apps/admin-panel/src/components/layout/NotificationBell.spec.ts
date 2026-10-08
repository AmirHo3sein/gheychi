import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import NotificationBell from './NotificationBell.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/reports', component: { template: '<div />' } },
      { path: '/salons/:id', component: { template: '<div />' } },
    ],
  })
}

// Every mount is unmounted afterwards: the bell listens on `document`, so a leaked instance
// from an earlier test would answer this test's events with its own fetches.
const mounted: Array<{ unmount: () => void }> = []

async function mountBell() {
  const router = makeRouter()
  router.push('/')
  await router.isReady()
  const wrapper = mount(NotificationBell, { global: { plugins: [router] } })
  mounted.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

const notification = {
  id: 'n1',
  type: 'report_created',
  title: 'گزارش جدید ثبت شد',
  body: 'یک کاربر سالنی را گزارش کرد.',
  link: '/reports',
  readAt: null,
  createdAt: '2026-07-10T10:00:00.000Z',
}

describe('NotificationBell', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    // Only fake interval timers: flushPromises and Vue's scheduler keep real timers.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount()
    vi.useRealTimers()
  })

  it('polls the unread count on mount and every 60 seconds, and stops on unmount', async () => {
    fetchMock.mockResolvedValue({ data: { count: 0 }, error: null })
    const { wrapper } = await mountBell()

    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications/unread-count', { silent: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60_000)
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    wrapper.unmount()
    vi.advanceTimersByTime(180_000)
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows a badge only when there are unread notifications', async () => {
    fetchMock.mockResolvedValueOnce({ data: { count: 3 }, error: null })
    const { wrapper } = await mountBell()

    expect(wrapper.find('[data-testid="unread-badge"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="unread-badge"]').text()).toBe('۳')
  })

  it('hides the badge when the count is zero', async () => {
    fetchMock.mockResolvedValueOnce({ data: { count: 0 }, error: null })
    const { wrapper } = await mountBell()

    expect(wrapper.find('[data-testid="unread-badge"]').exists()).toBe(false)
  })

  it('opens a dropdown listing the ten most recent notifications', async () => {
    // Opening the dropdown refreshes both the list AND the count, so dispatch by URL
    // instead of by call order.
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith('/admin/notifications?')
          ? { data: { items: [notification], total: 1, page: 1, pageSize: 10 }, error: null }
          : { data: { count: 1 }, error: null },
      ),
    )
    const { wrapper } = await mountBell()

    await wrapper.get('[data-testid="notification-bell"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications?page=1&pageSize=10', { silent: true })
    expect(wrapper.get('[data-testid="notification-dropdown"]').text()).toContain('گزارش جدید ثبت شد')
  })

  it('marks a clicked notification read and navigates to its link', async () => {
    fetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === 'PATCH') return Promise.resolve({ data: null, error: null })
      if (url.startsWith('/admin/notifications?'))
        return Promise.resolve({ data: { items: [{ ...notification }], total: 1, page: 1, pageSize: 10 }, error: null })
      return Promise.resolve({ data: { count: 1 }, error: null })
    })
    const { wrapper, router } = await mountBell()

    await wrapper.get('[data-testid="notification-bell"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="notification-item"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications/n1/read', { method: 'PATCH', silent: true })
    expect(router.currentRoute.value.path).toBe('/reports')
    expect(wrapper.find('[data-testid="unread-badge"]').exists()).toBe(false)
  })

  it('marks everything read via the mark-all affordance', async () => {
    fetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST') return Promise.resolve({ data: { ok: true }, error: null })
      if (url.startsWith('/admin/notifications?'))
        return Promise.resolve({ data: { items: [{ ...notification }], total: 1, page: 1, pageSize: 10 }, error: null })
      return Promise.resolve({ data: { count: 2 }, error: null })
    })
    const { wrapper } = await mountBell()

    await wrapper.get('[data-testid="notification-bell"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="mark-all-read"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications/read-all', { method: 'POST', silent: true })
    expect(wrapper.find('[data-testid="unread-badge"]').exists()).toBe(false)
  })

  describe('accessibility and polling', () => {
    function setVisibility(state: 'visible' | 'hidden') {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    }
    afterEach(() => setVisibility('visible'))

    it('exposes the popup state on the bell button', async () => {
      fetchMock.mockResolvedValue({ data: { count: 3, items: [], total: 0, page: 1, pageSize: 10 }, error: null })
      const { wrapper } = await mountBell()
      const bell = wrapper.get('[data-testid="notification-bell"]')
      expect(bell.attributes('aria-label')).toContain('اعلان‌ها')
      expect(bell.attributes('aria-haspopup')).toBe('true')
      expect(bell.attributes('aria-expanded')).toBe('false')
      expect(bell.attributes('aria-controls')).toBe('notification-panel')
      await bell.trigger('click')
      await flushPromises()
      expect(bell.attributes('aria-expanded')).toBe('true')
      expect(wrapper.get('#notification-panel').attributes('data-testid')).toBe('notification-dropdown')
    })

    it('closes on Escape and returns focus to the bell', async () => {
      fetchMock.mockResolvedValue({ data: { count: 0, items: [], total: 0, page: 1, pageSize: 10 }, error: null })
      const router = makeRouter()
      router.push('/')
      await router.isReady()
      const wrapper = mount(NotificationBell, { global: { plugins: [router] }, attachTo: document.body })
      await flushPromises()
      await wrapper.get('[data-testid="notification-bell"]').trigger('click')
      await flushPromises()
      await wrapper.get('[data-testid="notification-dropdown"]').trigger('keydown', { key: 'Escape' })
      expect(wrapper.find('[data-testid="notification-dropdown"]').exists()).toBe(false)
      expect(document.activeElement).toBe(wrapper.get('[data-testid="notification-bell"]').element)
      wrapper.unmount()
    })

    it('closes when the user clicks outside', async () => {
      fetchMock.mockResolvedValue({ data: { count: 0, items: [], total: 0, page: 1, pageSize: 10 }, error: null })
      const { wrapper } = await mountBell()
      await wrapper.get('[data-testid="notification-bell"]').trigger('click')
      await flushPromises()
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await flushPromises()
      expect(wrapper.find('[data-testid="notification-dropdown"]').exists()).toBe(false)
    })

    it('skips the badge poll while the tab is hidden and refreshes when it becomes visible', async () => {
      fetchMock.mockResolvedValue({ data: { count: 0 }, error: null })
      await mountBell()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      setVisibility('hidden')
      vi.advanceTimersByTime(60_000)
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      setVisibility('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledTimes(2)

      vi.advanceTimersByTime(60_000)
      await flushPromises()
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
  })
})
