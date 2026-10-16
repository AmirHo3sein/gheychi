import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppSelect from '@/components/ui/AppSelect.vue'
import NotificationsView from './NotificationsView.vue'

const fetchMock = vi.fn()
vi.mock('@/composables/useApi', () => ({ useApi: () => ({ apiFetch: fetchMock }) }))

const base = { body: null, link: null, readAt: null, createdAt: '2026-10-16T08:00:00.000Z' }
const critical = { ...base, id: 'c1', type: 'alert', severity: 'critical', title: 'استرداد گیر کرده', link: '/bookings' }
const backup = { ...base, type: 'alert', severity: 'warning', title: 'پشتیبان قدیمی است' }
const legacy = { ...base, id: 'l1', type: 'alert', severity: null, title: 'هشدار قدیمی' }
const report = { ...base, id: 'r1', type: 'report_created', severity: 'info', title: 'گزارش جدید', link: '/reports' }

// The API's effective severity (admin-notifications.service EFFECTIVE_SEVERITY_SQL): every
// non-alert row is 'info', and a pre-column alert with no stored severity is 'warning'.
type Row = { type: string; severity?: string | null; [key: string]: unknown }
const effectiveSeverity = (n: Row) => (n.type !== 'alert' ? 'info' : (n.severity ?? 'warning'))

// A fake of the list endpoint that applies ?type=&severity= the way the server does, so the
// view is exercised against server-side filtering rather than filtering anything itself.
function respond(pages: Row[][], total?: number) {
  fetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
    if (opts?.method) return Promise.resolve({ data: { ok: true }, error: null })
    const params = new URLSearchParams(url.split('?')[1])
    const page = Number(params.get('page'))
    const type = params.get('type')
    const severity = params.get('severity')
    const matches = (n: Row) => (!type || n.type === type) && (!severity || effectiveSeverity(n) === severity)
    const items = (pages[page - 1] ?? []).filter(matches)
    return Promise.resolve({
      data: { items, total: type || severity ? pages.flat().filter(matches).length : (total ?? pages.flat().length), page, pageSize: 50 },
      error: null,
    })
  })
}

async function mountAt(path = '/notifications') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/notifications', component: NotificationsView },
      { path: '/bookings', component: { template: '<div />' } },
      { path: '/reports', component: { template: '<div />' } },
    ],
  })
  router.push(path)
  await router.isReady()
  const wrapper = mount(NotificationsView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

const rows = (w: Awaited<ReturnType<typeof mountAt>>['wrapper']) => w.findAll('[data-testid="notification-row"]')
const select = (w: Awaited<ReturnType<typeof mountAt>>['wrapper'], label: string) =>
  w.findAllComponents(AppSelect).find((s) => s.props('label') === label)!

describe('NotificationsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('lists notifications with their API severity, reading a legacy null severity as a warning', async () => {
    respond([[critical, legacy, report]])
    const { wrapper } = await mountAt()
    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications?page=1&pageSize=50', { silent: true })
    expect(rows(wrapper).map((r) => r.attributes('data-severity'))).toEqual(['critical', 'warning', 'action'])
    expect(rows(wrapper)[0]!.text()).toContain('بحرانی')
    expect(rows(wrapper)[1]!.text()).not.toContain('بحرانی')
  })

  it('collapses consecutive repeats into one ×N row', async () => {
    respond([[{ ...backup, id: 'b1' }, { ...backup, id: 'b2' }, { ...backup, id: 'b3' }, report]])
    const { wrapper } = await mountAt()
    expect(rows(wrapper)).toHaveLength(2)
    expect(rows(wrapper)[0]!.get('[data-testid="notification-repeat"]').text()).toContain('×۳')
  })

  it('filters by severity and type on the server, and keeps both filters in the URL', async () => {
    respond([[critical, legacy, report]])
    const { wrapper, router } = await mountAt()

    await select(wrapper, 'سطح').vm.$emit('update:modelValue', 'critical')
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/admin/notifications?page=1&pageSize=50&severity=critical', { silent: true })
    expect(rows(wrapper)).toHaveLength(1)
    expect(rows(wrapper)[0]!.text()).toContain('استرداد گیر کرده')
    expect(router.currentRoute.value.query).toEqual({ severity: 'critical' })

    await select(wrapper, 'سطح').vm.$emit('update:modelValue', '')
    await select(wrapper, 'نوع').vm.$emit('update:modelValue', 'report_created')
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/admin/notifications?page=1&pageSize=50&type=report_created', { silent: true })
    expect(rows(wrapper).map((r) => r.text())).toEqual([expect.stringContaining('گزارش جدید')])
    expect(router.currentRoute.value.query).toEqual({ type: 'report_created' })
  })

  it('reports the exact filtered total from the server and says so when nothing matches', async () => {
    respond([[critical, legacy, report]])
    const { wrapper } = await mountAt('/notifications?severity=warning')
    expect(rows(wrapper).map((r) => r.attributes('data-severity'))).toEqual(['warning'])
    expect(wrapper.get('[data-testid="notifications-loaded-count"]').text()).toContain('۱ از ۱')

    await select(wrapper, 'نوع').vm.$emit('update:modelValue', 'report_created')
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/admin/notifications?page=1&pageSize=50&severity=warning&type=report_created', { silent: true })
    expect(rows(wrapper)).toHaveLength(0)
    expect(wrapper.text()).toContain('اعلانی با این فیلترها وجود ندارد.')
  })

  it('clearing every filter at once costs a single reload', async () => {
    respond([[critical, legacy, report]])
    const { wrapper } = await mountAt('/notifications?severity=critical&type=alert&unread=true')
    fetchMock.mockClear()
    await wrapper.get('[data-testid="clear-filters"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications?page=1&pageSize=50', { silent: true })
    expect(rows(wrapper)).toHaveLength(3)
  })

  it('opens pre-filtered from the banner link and asks the API for unread only', async () => {
    respond([[critical, legacy]])
    const { wrapper } = await mountAt('/notifications?severity=critical&unread=true')
    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications?page=1&pageSize=50&unread=true&severity=critical', { silent: true })
    expect(rows(wrapper)).toHaveLength(1)
    expect(wrapper.get('[data-testid="filter-unread"]').attributes('aria-checked')).toBe('true')
  })

  it('switching to unread re-fetches from the server', async () => {
    respond([[critical, report]])
    const { wrapper, router } = await mountAt()
    await wrapper.get('[data-testid="filter-unread"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/admin/notifications?page=1&pageSize=50&unread=true', { silent: true })
    expect(router.currentRoute.value.query).toEqual({ unread: 'true' })
  })

  it('marks a whole group read without navigating, and announces the change', async () => {
    respond([[{ ...backup, id: 'b1' }, { ...backup, id: 'b2' }, report]])
    const listener = vi.fn()
    window.addEventListener('admin-notifications-changed', listener)
    const { wrapper, router } = await mountAt()

    await rows(wrapper)[0]!.get('[data-testid="notification-mark-read"]').trigger('click')
    await flushPromises()
    for (const id of ['b1', 'b2']) {
      expect(fetchMock).toHaveBeenCalledWith(`/admin/notifications/${id}/read`, { method: 'PATCH', silent: true })
    }
    expect(rows(wrapper)[0]!.attributes('data-unread')).toBe('false')
    expect(rows(wrapper)[0]!.find('[data-testid="notification-mark-read"]').exists()).toBe(false)
    expect(router.currentRoute.value.path).toBe('/notifications')
    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener('admin-notifications-changed', listener)
  })

  it('opening a row marks it read and follows its link', async () => {
    respond([[critical]])
    const { wrapper, router } = await mountAt()
    await wrapper.get('[data-testid="notification-open"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications/c1/read', { method: 'PATCH', silent: true })
    expect(router.currentRoute.value.path).toBe('/bookings')
  })

  it('marks everything read', async () => {
    respond([[critical, report]])
    const { wrapper } = await mountAt()
    await wrapper.get('[data-testid="notifications-mark-all"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications/read-all', { method: 'POST' })
    expect(rows(wrapper).every((r) => r.attributes('data-unread') === 'false')).toBe(true)
  })

  it('loads further pages on demand, skipping a row repeated across the page boundary', async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => ({ ...report, id: `p${i}`, title: `مورد ${i}` }))
    const page2 = [page1[49]!, { ...critical, id: 'last' }]
    respond([page1, page2], 51)
    const { wrapper } = await mountAt()
    expect(wrapper.get('[data-testid="notifications-loaded-count"]').text()).toContain('۵۰ از ۵۱')

    await wrapper.get('[data-testid="notifications-load-more"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/admin/notifications?page=2&pageSize=50', { silent: true })
    expect(rows(wrapper)).toHaveLength(51)
    expect(wrapper.find('[data-testid="notifications-load-more"]').exists()).toBe(false)
  })

  it('in unread-only mode, marking rows read never makes «بارگذاری بیشتر» skip unread rows', async () => {
    // A stateful fake of the server: ?unread=true pages over the CURRENT unread set, so rows
    // marked read since page 1 drop out and every later page shifts up by that many.
    const all = Array.from({ length: 120 }, (_, i) => ({ ...report, id: `u${i}`, title: `مورد ${i}`, readAt: null as string | null }))
    fetchMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (opts?.method === 'PATCH') {
        const id = url.split('/')[3]
        all.find((n) => n.id === id)!.readAt = '2026-10-16T09:00:00.000Z'
        return Promise.resolve({ data: { ok: true }, error: null })
      }
      const params = new URLSearchParams(url.split('?')[1])
      const page = Number(params.get('page'))
      const size = Number(params.get('pageSize'))
      const set = params.get('unread') === 'true' ? all.filter((n) => !n.readAt) : all
      return Promise.resolve({
        data: { items: set.slice((page - 1) * size, page * size).map((n) => ({ ...n })), total: set.length, page, pageSize: size },
        error: null,
      })
    })
    const { wrapper } = await mountAt('/notifications?unread=true')
    expect(rows(wrapper)).toHaveLength(50)

    // Mark the first ten read from the inbox itself.
    for (let i = 0; i < 10; i++) {
      await wrapper.findAll('[data-testid="notification-mark-read"]')[0]!.trigger('click')
      await flushPromises()
    }
    // The count line reads against the server's current unread total, not the stale one.
    expect(wrapper.get('[data-testid="notifications-loaded-count"]').text()).toContain('۴۰ از ۱۱۰')
    // Keep loading until the server says there is nothing more.
    for (let guard = 0; guard < 10 && wrapper.find('[data-testid="notifications-load-more"]').exists(); guard++) {
      await wrapper.get('[data-testid="notifications-load-more"]').trigger('click')
      await flushPromises()
    }
    // Every originally-unread row is in the list exactly once -- u50..u59 included, which
    // shifted onto page 1 once u0..u9 were read.
    expect(rows(wrapper)).toHaveLength(120)
    const text = wrapper.get('[data-testid="notifications-list"]').text()
    for (const i of [50, 55, 59, 119]) expect(text).toContain(`مورد ${i}`)
  })

  it('shows a retryable error state rather than an empty inbox when the fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'boom' } })
    const { wrapper } = await mountAt()
    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('اعلانی وجود ندارد')
    respond([[report]])
    await wrapper.get('[data-testid="retry-load"]').trigger('click')
    await flushPromises()
    expect(rows(wrapper)).toHaveLength(1)
  })
})
