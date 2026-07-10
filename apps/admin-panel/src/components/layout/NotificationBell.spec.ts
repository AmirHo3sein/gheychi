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

async function mountBell() {
  const router = makeRouter()
  router.push('/')
  await router.isReady()
  const wrapper = mount(NotificationBell, { global: { plugins: [router] } })
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
    expect(wrapper.get('[data-testid="unread-badge"]').text()).toBe('3')
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
})
