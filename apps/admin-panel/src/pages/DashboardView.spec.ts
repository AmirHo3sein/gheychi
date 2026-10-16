import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

// The dashboard renders a real ECharts instance via vue-echarts -- irrelevant to these tests
// and heavy (canvas/zrender) to mount for real, so the module itself is replaced.
const VChartStub = defineComponent({
  name: 'VChart',
  props: ['option'],
  render() {
    return h('div', { 'data-testid': 'vchart-stub' })
  },
})
vi.mock('vue-echarts', () => ({ default: VChartStub }))

const { default: DashboardView } = await import('./DashboardView.vue')

const mountOptions = { global: { stubs: { RouterLink: RouterLinkStub } } }

function series(created = 0, completed = 0) {
  return Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    created: i === 29 ? created : 0,
    completed: i === 29 ? completed : 0,
  }))
}

// Shape of GET /admin/dashboard-summary (AdminDashboardSummary in the API).
function summary(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-10-16T08:00:00.000Z',
    today: '2026-10-16',
    salons: { byStatus: { pending: 3, approved: 40, rejected: 2, suspended: 1 }, total: 46 },
    users: { byRole: { customer: 4321, provider: 46, admin: 2 }, suspended: 5, total: 4369 },
    bookings: {
      today: { total: 12, pending: 2, confirmed: 6, completed: 3, noShow: 0, cancelled: 1, byStatus: {} },
      last7Days: { created: 70, completed: 40 },
      last30Days: { created: 300, completed: 180 },
      series: series(9, 4),
      pendingApprovalNow: 2,
    },
    payments: { refundPending: 1 },
    moderation: { openReports: 4, pendingCategoryRequests: 0 },
    revenueLast30Days: { grossAmount: 12500000, commissionAmount: 1250000, accruals: 50 },
    subscriptions: { byPlan: [{ planId: 'p1', planKey: 'free', planName: 'رایگان', activeCount: 46 }] },
    alerts: { unreadCritical: 2, unreadWarning: 7 },
    backup: { lastSuccessAt: '2026-10-16T01:00:00.000Z', status: 'ok', staleAfterHours: 27 },
    ...overrides,
  }
}

const allClear = () =>
  summary({
    salons: { byStatus: { pending: 0, approved: 40, rejected: 2, suspended: 1 }, total: 43 },
    payments: { refundPending: 0 },
    moderation: { openReports: 0, pendingCategoryRequests: 0 },
    alerts: { unreadCritical: 0, unreadWarning: 7 },
  })

describe('DashboardView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('reads everything from the one summary endpoint -- no client-side counting of list pages', async () => {
    fetchMock.mockResolvedValue({ data: summary(), error: null })
    mount(DashboardView, mountOptions)
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/admin/dashboard-summary', { silent: true })
  })

  it('leads with the items that need attention, each linking to its filtered page', async () => {
    fetchMock.mockResolvedValue({ data: summary(), error: null })
    const wrapper = mount(DashboardView, mountOptions)
    await flushPromises()

    const link = (key: string) => wrapper.get(`[data-testid="attention-${key}"]`)
    const tiles = wrapper.findAllComponents(RouterLinkStub).filter((l) => l.attributes('data-testid')?.startsWith('attention-'))
    const byKey = Object.fromEntries(tiles.map((t) => [t.attributes('data-testid'), t.props('to')]))
    expect(byKey).toEqual({
      'attention-critical-alerts': '/notifications?severity=critical&unread=true',
      'attention-refund-pending': '/bookings?paymentStatus=refund_pending',
      'attention-pending-salons': '/salons?status=pending',
      'attention-open-reports': '/reports',
    })
    // A zero count is not an attention item (pending category requests is 0 here).
    expect(wrapper.find('[data-testid="attention-category-requests"]').exists()).toBe(false)
    expect(link('pending-salons').text()).toContain('۳')
    expect(wrapper.find('[data-testid="dashboard-all-clear"]').exists()).toBe(false)
  })

  it('shows the all-clear state, with the mascot, when nothing needs attention', async () => {
    fetchMock.mockResolvedValue({ data: allClear(), error: null })
    const wrapper = mount(DashboardView, mountOptions)
    await flushPromises()

    const clear = wrapper.get('[data-testid="dashboard-all-clear"]')
    expect(clear.text()).toContain('همه‌چیز مرتب است')
    expect(clear.find('img[src="/mascot/happy.webp"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid^="attention-"]')).toHaveLength(0)
    // Unread warnings alone do not count as needing attention (only critical ones do).
    expect(wrapper.text()).toContain('آخرین پشتیبان موفق')
  })

  it('flags a stale or missing backup from the real backup field, and is then not all-clear', async () => {
    fetchMock.mockResolvedValue({
      data: { ...allClear(), backup: { lastSuccessAt: null, status: 'missing', staleAfterHours: 27 } },
      error: null,
    })
    const wrapper = mount(DashboardView, mountOptions)
    await flushPromises()
    expect(wrapper.find('[data-testid="dashboard-all-clear"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="attention-backup"]').text()).toContain('ثبت نشده')
    expect(wrapper.find('[data-testid="backup-ok"]').exists()).toBe(false)
  })

  it('formats every figure with fa-IR digits, money included', async () => {
    fetchMock.mockResolvedValue({ data: summary(), error: null })
    const wrapper = mount(DashboardView, mountOptions)
    await flushPromises()
    expect(wrapper.text()).toContain((4321).toLocaleString('fa-IR'))
    expect(wrapper.get('[data-testid="kpi-gross-30d"]').text()).toContain((12500000).toLocaleString('fa-IR'))
    expect(wrapper.get('[data-testid="kpi-commission-30d"]').text()).toContain((1250000).toLocaleString('fa-IR'))
    expect(wrapper.text()).not.toContain('4321')
  })

  it('links each salon status and user role row to the matching filtered list', async () => {
    fetchMock.mockResolvedValue({ data: summary(), error: null })
    const wrapper = mount(DashboardView, mountOptions)
    await flushPromises()
    const linksIn = (testid: string) =>
      wrapper
        .findAllComponents(RouterLinkStub)
        .filter((l) => wrapper.get(`[data-testid="${testid}"]`).element.contains(l.element))
        .map((l) => l.props('to'))
    expect(linksIn('breakdown-salons')).toEqual(['/salons?status=pending', '/salons?status=approved', '/salons?status=rejected', '/salons?status=suspended'])
    expect(linksIn('breakdown-users')).toEqual(['/users?role=customer', '/users?role=provider', '/users?role=admin'])
  })

  it('shows loading placeholders, not false zeros, while the summary is in flight', async () => {
    let resolve!: (v: unknown) => void
    fetchMock.mockImplementation(() => new Promise((r) => (resolve = r)))
    const wrapper = mount(DashboardView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="attention-loading"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="chart-loading"]')).toHaveLength(1)
    for (const el of wrapper.findAll('[data-testid="stat-value"]')) expect(el.text()).toBe('—')
    expect(wrapper.find('[data-testid="dashboard-all-clear"]').exists()).toBe(false)

    resolve({ data: summary(), error: null })
    await flushPromises()
    expect(wrapper.findAll('[data-testid="chart-loading"]')).toHaveLength(0)
    expect(wrapper.findComponent(VChartStub).exists()).toBe(true)
  })

  it('shows a distinct, retryable error state instead of zero counts when the summary fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'boom' } })
    const wrapper = mount(DashboardView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="dashboard-error-banner"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="chart-error"]')).toHaveLength(1)
    for (const el of wrapper.findAll('[data-testid="stat-value"]')) expect(el.text()).toBe('—')
    // A failure is never mistaken for "all clear".
    expect(wrapper.find('[data-testid="dashboard-all-clear"]').exists()).toBe(false)

    fetchMock.mockResolvedValueOnce({ data: summary(), error: null })
    await wrapper.get('[data-testid="dashboard-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="dashboard-error-banner"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="attention-pending-salons"]').exists()).toBe(true)
  })

  it('shows the chart empty state when the 30-day series is all zero', async () => {
    fetchMock.mockResolvedValue({
      data: summary({ bookings: { ...summary().bookings, series: series(0, 0) } }),
      error: null,
    })
    const wrapper = mount(DashboardView, mountOptions)
    await flushPromises()
    expect(wrapper.text()).toContain('در ۳۰ روز اخیر نوبتی ثبت نشده است.')
    expect(wrapper.findComponent(VChartStub).exists()).toBe(false)
  })

  it('announces load completion and failure via an aria-live region', async () => {
    fetchMock.mockResolvedValue({ data: summary(), error: null })
    const wrapper = mount(DashboardView, mountOptions)
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('')
    await flushPromises()
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('اطلاعات داشبورد بارگذاری شد.')

    fetchMock.mockResolvedValue({ data: null, error: { status: 500, message: 'boom' } })
    const errorWrapper = mount(DashboardView, mountOptions)
    await flushPromises()
    expect(errorWrapper.get('[aria-live="polite"]').text()).toBe('بارگذاری اطلاعات داشبورد با خطا مواجه شد.')
  })
})
