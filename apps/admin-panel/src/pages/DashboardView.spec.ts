import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

// The dashboard renders real ECharts instances via vue-echarts -- irrelevant to these
// tests and heavy (canvas/zrender) to mount for real, so the module itself is replaced.
// global.stubs keyed by tag name doesn't reliably match here: vue-echarts's internal
// component name is "Echarts", not the local import binding "VChart" these SFCs use.
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

function ok<T>(data: T) {
  return { data, error: null }
}

const salonsPayload = {
  items: [
    { status: 'pending', genderTarget: 'women' },
    { status: 'approved', genderTarget: 'men' },
  ],
  total: 2,
}
const usersPayload = [
  { role: 'customer', status: 'active' },
  { role: 'admin', status: 'suspended' },
]
const reviewsPayload = { items: [{ rating: 5, status: 'published' }], total: 1 }
const categoriesPayload = [{ id: 1 }, { id: 2 }, { id: 3 }]
const reportsPayload = { items: [], total: 4321 }

function resolvedFetch(overrides: Record<string, unknown> = {}) {
  return (url: string) => {
    if (url.startsWith('/admin/salons')) return Promise.resolve(overrides.salons ?? ok(salonsPayload))
    if (url === '/admin/users') return Promise.resolve(overrides.users ?? ok(usersPayload))
    if (url.startsWith('/admin/reviews')) return Promise.resolve(overrides.reviews ?? ok(reviewsPayload))
    if (url === '/categories') return Promise.resolve(overrides.categories ?? ok(categoriesPayload))
    if (url.startsWith('/admin/reports')) return Promise.resolve(overrides.reports ?? ok(reportsPayload))
    throw new Error(`unexpected url: ${url}`)
  }
}

describe('DashboardView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('formats stat card values with fa-IR digit grouping, like the rest of the app', async () => {
    fetchMock.mockImplementation(resolvedFetch())
    const wrapper = mount(DashboardView, mountOptions)
    await flushPromises()

    // The open-reports stat card carries the 4321 total -- rendered as Persian digits,
    // matching WalletView/AdjustBalanceCard/ReferralsView's .toLocaleString('fa-IR') use.
    expect(wrapper.text()).toContain((4321).toLocaleString('fa-IR'))
    expect(wrapper.text()).not.toContain('4321')
  })

  it('shows a loading indicator, not a false empty state, while the initial fetches are in flight', async () => {
    const resolvers: Record<string, () => void> = {}
    fetchMock.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          if (url.startsWith('/admin/salons')) resolvers.salons = () => resolve(ok(salonsPayload))
          else if (url === '/admin/users') resolvers.users = () => resolve(ok(usersPayload))
          else if (url.startsWith('/admin/reviews')) resolvers.reviews = () => resolve(ok(reviewsPayload))
          else if (url === '/categories') resolvers.categories = () => resolve(ok(categoriesPayload))
          else if (url.startsWith('/admin/reports')) resolvers.reports = () => resolve(ok(reportsPayload))
        }),
    )
    const wrapper = mount(DashboardView, mountOptions)
    await flushPromises()

    // Still loading: every chart shows its spinner, none show the "no data" copy, and
    // stat values render the neutral placeholder rather than a false zero.
    expect(wrapper.findAll('[data-testid="chart-loading"]')).toHaveLength(4)
    expect(wrapper.findAll('[data-testid="chart-error"]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('داده‌ای برای نمایش موجود نیست')
    expect(wrapper.text()).not.toContain('هنوز نظری ثبت نشده است')
    for (const el of wrapper.findAll('[data-testid="stat-value"]')) expect(el.text()).toBe('—')

    Object.values(resolvers).forEach((resolve) => resolve())
    await flushPromises()

    expect(wrapper.findAll('[data-testid="chart-loading"]')).toHaveLength(0)
    expect(wrapper.findComponent(VChartStub).exists()).toBe(true)
  })

  it('shows a distinct error state instead of silently rendering zero counts when a fetch fails', async () => {
    fetchMock.mockImplementation(resolvedFetch({ users: { data: null, error: { status: 500, message: 'boom' } } }))
    const wrapper = mount(DashboardView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="dashboard-error-banner"]').exists()).toBe(true)
    // Every chart -- including ones whose own underlying fetch succeeded -- surfaces the
    // shared error state rather than rendering some charts normally and others as if empty.
    expect(wrapper.findAll('[data-testid="chart-error"]')).toHaveLength(4)
    expect(wrapper.findAll('[data-testid="chart-loading"]')).toHaveLength(0)
    for (const el of wrapper.findAll('[data-testid="stat-value"]')) expect(el.text()).toBe('—')
  })

  it('announces load completion and failure via an aria-live region', async () => {
    fetchMock.mockImplementation(resolvedFetch())
    const wrapper = mount(DashboardView, mountOptions)
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('')
    await flushPromises()
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('اطلاعات داشبورد بارگذاری شد.')

    fetchMock.mockImplementation(resolvedFetch({ categories: { data: null, error: { status: 500, message: 'boom' } } }))
    const errorWrapper = mount(DashboardView, mountOptions)
    await flushPromises()
    expect(errorWrapper.get('[aria-live="polite"]').text()).toBe('بارگذاری اطلاعات داشبورد با خطا مواجه شد.')
  })

  it('steps stat-card density at sm and lg, not just a two-step jump', () => {
    fetchMock.mockImplementation(resolvedFetch())
    const wrapper = mount(DashboardView, mountOptions)
    const grid = wrapper.find('.grid.grid-cols-2')
    expect(grid.classes()).toEqual(expect.arrayContaining(['grid-cols-2', 'sm:grid-cols-3', 'lg:grid-cols-5']))
  })
})
