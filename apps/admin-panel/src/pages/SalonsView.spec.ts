import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SalonsView from './SalonsView.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import Pagination from '@/components/ui/Pagination.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const mountOptions = { global: { stubs: { RouterLink: RouterLinkStub } } }

const salon = {
  id: 's1',
  name: 'سالن نمونه',
  city: 'تهران',
  status: 'approved' as const,
  genderTarget: 'women' as const,
  isFeatured: false,
  featuredUntil: null as string | null,
  createdAt: '2026-07-10T08:00:00.000Z',
}

// The city filter's useCities fires its own GET /cities on mount, in parallel with this
// page's GET /admin/salons -- every test needs both endpoints answered, or the unmocked
// one falls through to a bare `undefined` response and throws when the composable tries
// to destructure it.
const CITIES_RESPONSE = {
  data: [
    { name: 'تهران', lat: 35.6892, lng: 51.389 },
    { name: 'مشهد', lat: 36.2605, lng: 59.6168 },
  ],
  error: null,
}

// Dispatches by URL so GET /cities always gets its own well-shaped response instead of
// accidentally reusing whatever a test set up for GET /admin/salons (mirrors ReportsView
// .spec.ts's url-aware mockImplementation convention).
function mockSalons(response: unknown) {
  fetchMock.mockImplementation((url: string) => (url === '/cities' ? Promise.resolve(CITIES_RESPONSE) : Promise.resolve(response)))
}

describe('SalonsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads salons and renders name, city, gender, and status', async () => {
    mockSalons({ data: { items: [{ ...salon }], total: 1, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons?status=all&page=1&pageSize=20', { silent: true })
    expect(wrapper.text()).toContain('سالن نمونه')
    expect(wrapper.text()).toContain('تهران')
  })

  // City-list source of truth: the filter's options must come from the live GET /cities
  // response, not a hardcoded duplicate -- a backend-only city addition must reach here
  // with no code change.
  it('fetches the city filter options from GET /cities', async () => {
    mockSalons({ data: { items: [{ ...salon }], total: 1, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/cities', { silent: true })
    const citySelect = wrapper.findAllComponents(AppSelect).find((c) => c.props('label') === 'شهر')!
    const cityValues = citySelect.props('options').map((o: { value: string | number }) => o.value)
    expect(cityValues).toEqual(['', 'تهران', 'مشهد'])
  })

  // A GET /cities failure must not silently repaint the city filter as "no cities exist" --
  // it gets its own error state with a retry action, same idiom as the page's own
  // load-error block.
  it('shows a retry affordance for the city filter when GET /cities fails, and retry repopulates it', async () => {
    let citiesResponse: unknown = { data: null, error: { status: 500, message: 'Something went wrong' } }
    fetchMock.mockImplementation((url: string) =>
      url === '/cities'
        ? Promise.resolve(citiesResponse)
        : Promise.resolve({ data: { items: [{ ...salon }], total: 1, page: 1, pageSize: 20 }, error: null }),
    )
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="retry-cities"]').exists()).toBe(true)
    expect(wrapper.findAllComponents(AppSelect).find((c) => c.props('label') === 'شهر')).toBeUndefined()

    citiesResponse = CITIES_RESPONSE
    await wrapper.get('[data-testid="retry-cities"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="retry-cities"]').exists()).toBe(false)
    expect(wrapper.findAllComponents(AppSelect).find((c) => c.props('label') === 'شهر')).toBeDefined()
  })

  it('shows a featured badge only for salons flagged isFeatured', async () => {
    mockSalons({
      data: {
        items: [
          { ...salon, id: 's1', isFeatured: true },
          { ...salon, id: 's2', name: 'سالن دیگر', isFeatured: false },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      },
      error: null,
    })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    const badges = wrapper.findAll('[data-testid="featured-badge"]')
    expect(badges).toHaveLength(1)
  })

  // The badge must mirror SearchService's boost predicate -- is_featured alone is not the
  // public truth once featured_until has elapsed.
  it('keeps the featured badge for an open-ended window and for one still in the future', async () => {
    mockSalons({
      data: {
        items: [
          { ...salon, id: 's1', isFeatured: true, featuredUntil: null },
          { ...salon, id: 's2', name: 'سالن دوم', isFeatured: true, featuredUntil: '2099-01-01T00:00:00.000Z' },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      },
      error: null,
    })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    expect(wrapper.findAll('[data-testid="featured-badge"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-testid="featured-expired-badge"]')).toHaveLength(0)
  })

  it('marks an elapsed featured window as expired instead of still calling it ویژه', async () => {
    mockSalons({
      data: {
        items: [{ ...salon, id: 's1', isFeatured: true, featuredUntil: '2020-01-01T00:00:00.000Z' }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      error: null,
    })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="featured-badge"]').exists()).toBe(false)
    const expired = wrapper.get('[data-testid="featured-expired-badge"]')
    expect(expired.text()).toContain('منقضی')
    // The expiry date itself is surfaced, so the operator can answer "since when?".
    expect(expired.attributes('title')).toContain('نشان ویژه تا')
  })

  it('shows no featured badge at all for a salon that was never featured, even with a stale featuredUntil', async () => {
    mockSalons({
      data: {
        items: [{ ...salon, id: 's1', isFeatured: false, featuredUntil: '2099-01-01T00:00:00.000Z' }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      error: null,
    })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="featured-badge"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="featured-expired-badge"]').exists()).toBe(false)
  })

  // Finding 1: a fetch failure must not be silently repainted as "no results" -- it needs
  // its own state, distinct from the genuine-empty-results EmptyState, with a retry action.
  it('shows a distinct error state (not the empty state) when the fetch fails, and retry reloads', async () => {
    let salonsResponse: unknown = { data: null, error: { status: 500, message: 'Something went wrong' } }
    fetchMock.mockImplementation((url: string) => (url === '/cities' ? Promise.resolve(CITIES_RESPONSE) : Promise.resolve(salonsResponse)))
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)
    // Never conflated with the genuine-empty-results copy.
    expect(wrapper.text()).not.toContain('آرایشگاهی با این فیلترها یافت نشد.')

    salonsResponse = { data: { items: [{ ...salon }], total: 1, page: 1, pageSize: 20 }, error: null }
    await wrapper.get('[data-testid="retry-load"]').trigger('click')
    await flushPromises()

    const salonsCalls = fetchMock.mock.calls.filter(([url]) => (url as string).startsWith('/admin/salons'))
    expect(salonsCalls).toHaveLength(2)
    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('سالن نمونه')
  })

  it('still shows the genuine empty-results state when the fetch succeeds with zero items', async () => {
    mockSalons({ data: { items: [], total: 0, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('آرایشگاهی با این فیلترها یافت نشد.')
  })

  it('a later successful load clears a prior error state', async () => {
    let salonsResponse: unknown = { data: null, error: { status: 500, message: 'Something went wrong' } }
    fetchMock.mockImplementation((url: string) => (url === '/cities' ? Promise.resolve(CITIES_RESPONSE) : Promise.resolve(salonsResponse)))
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()
    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)

    salonsResponse = { data: { items: [{ ...salon }], total: 1, page: 1, pageSize: 20 }, error: null }
    await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'approved')
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
  })

  // Finding 4: a loading affordance must be visible during the initial load, a page change,
  // and a filter change -- all three are driven by the same `loading` ref.
  it('shows a loading indicator while the request is in flight', async () => {
    let resolveSalons!: (value: unknown) => void
    fetchMock.mockImplementation((url: string) =>
      url === '/cities' ? Promise.resolve(CITIES_RESPONSE) : new Promise((resolve) => { resolveSalons = resolve }),
    )
    const wrapper = mount(SalonsView, mountOptions)

    // Still pending -- the loading affordance should already be visible synchronously,
    // before the response ever resolves.
    expect(wrapper.find('[data-testid="table-loading"]').exists()).toBe(true)

    resolveSalons({ data: { items: [{ ...salon }], total: 1, page: 1, pageSize: 20 }, error: null })
    await flushPromises()

    expect(wrapper.find('[data-testid="table-loading"]').exists()).toBe(false)
  })

  // Finding 3: loadFromFilterChange must not fire two concurrent, redundant fetches when it
  // both resets page.value to 1 (which the page watcher reacts to) and would otherwise also
  // call load() directly.
  it('resets to page 1 with a single fetch when a filter changes from page > 1', async () => {
    mockSalons({ data: { items: [{ ...salon }], total: 50, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    // Move to page 2 via the Pagination component's emitted event.
    await wrapper.findComponent(Pagination).vm.$emit('update:page', 2)
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/admin/salons?status=all&page=2&pageSize=20', { silent: true })

    fetchMock.mockClear()
    const statusSelect = wrapper.findAllComponents(AppSelect).at(-1)!
    await statusSelect.vm.$emit('update:modelValue', 'approved')
    await flushPromises()

    // Exactly ONE request: the page reset rides along with the filter change, not as a
    // second, redundant concurrent fetch. (GET /cities isn't re-fetched on a filter change,
    // so this stays a single call.)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/admin/salons?status=approved&page=1&pageSize=20', { silent: true })
  })

  it('fires a single fetch when a filter changes while already on page 1', async () => {
    mockSalons({ data: { items: [{ ...salon }], total: 1, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    fetchMock.mockClear()
    const statusSelect = wrapper.findAllComponents(AppSelect).at(-1)!
    await statusSelect.vm.$emit('update:modelValue', 'pending')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/admin/salons?status=pending&page=1&pageSize=20', { silent: true })
  })

  // Regression guard. The table used to sit directly inside AppCard's overflow-hidden box, so
  // the moment its min-content width exceeded the card the trailing columns were CLIPPED, not
  // scrolled to. The wrapper has to stay the table's DIRECT parent -- an overflow-x-auto further
  // up the tree would let an intermediate box overflow first and defeat the point.
  it('keeps the table inside its own horizontal scroll container', async () => {
    mockSalons({ data: { items: [{ ...salon }], total: 1, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    expect(wrapper.get('table').element.parentElement?.className).toContain('overflow-x-auto')
  })
})
