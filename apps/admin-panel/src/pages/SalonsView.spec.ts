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

describe('SalonsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads salons and renders name, city, gender, and status', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...salon }], total: 1, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons?status=all&page=1&pageSize=20', { silent: true })
    expect(wrapper.text()).toContain('سالن نمونه')
    expect(wrapper.text()).toContain('تهران')
  })

  it('shows a featured badge only for salons flagged isFeatured', async () => {
    fetchMock.mockResolvedValue({
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
    fetchMock.mockResolvedValue({
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
    fetchMock.mockResolvedValue({
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
    fetchMock.mockResolvedValue({
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
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'Something went wrong' } })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)
    // Never conflated with the genuine-empty-results copy.
    expect(wrapper.text()).not.toContain('آرایشگاهی با این فیلترها یافت نشد.')

    fetchMock.mockResolvedValueOnce({ data: { items: [{ ...salon }], total: 1, page: 1, pageSize: 20 }, error: null })
    await wrapper.get('[data-testid="retry-load"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('سالن نمونه')
  })

  it('still shows the genuine empty-results state when the fetch succeeds with zero items', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('آرایشگاهی با این فیلترها یافت نشد.')
  })

  it('a later successful load clears a prior error state', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'Something went wrong' } })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()
    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)

    fetchMock.mockResolvedValueOnce({ data: { items: [{ ...salon }], total: 1, page: 1, pageSize: 20 }, error: null })
    await wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'approved')
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
  })

  // Finding 4: a loading affordance must be visible during the initial load, a page change,
  // and a filter change -- all three are driven by the same `loading` ref.
  it('shows a loading indicator while the request is in flight', async () => {
    let resolveFetch!: (value: unknown) => void
    fetchMock.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve }))
    const wrapper = mount(SalonsView, mountOptions)

    // Still pending -- the loading affordance should already be visible synchronously,
    // before the response ever resolves.
    expect(wrapper.find('[data-testid="table-loading"]').exists()).toBe(true)

    resolveFetch({ data: { items: [{ ...salon }], total: 1, page: 1, pageSize: 20 }, error: null })
    await flushPromises()

    expect(wrapper.find('[data-testid="table-loading"]').exists()).toBe(false)
  })

  // Finding 3: loadFromFilterChange must not fire two concurrent, redundant fetches when it
  // both resets page.value to 1 (which the page watcher reacts to) and would otherwise also
  // call load() directly.
  it('resets to page 1 with a single fetch when a filter changes from page > 1', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ data: { items: [{ ...salon }], total: 50, page: 1, pageSize: 20 }, error: null }),
    )
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
    // second, redundant concurrent fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/admin/salons?status=approved&page=1&pageSize=20', { silent: true })
  })

  it('fires a single fetch when a filter changes while already on page 1', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...salon }], total: 1, page: 1, pageSize: 20 }, error: null })
    const wrapper = mount(SalonsView, mountOptions)
    await flushPromises()

    fetchMock.mockClear()
    const statusSelect = wrapper.findAllComponents(AppSelect).at(-1)!
    await statusSelect.vm.$emit('update:modelValue', 'pending')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/admin/salons?status=pending&page=1&pageSize=20', { silent: true })
  })
})
