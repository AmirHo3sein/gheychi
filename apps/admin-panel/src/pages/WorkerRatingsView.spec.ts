import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppSelect from '@/components/ui/AppSelect.vue'
import Pagination from '@/components/ui/Pagination.vue'
import WorkerRatingsView from './WorkerRatingsView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const mountOptions = { global: { stubs: { RouterLink: RouterLinkStub } } }

const rating = {
  id: 'wr-1',
  workerId: 'w-1',
  workerName: 'آرش کریمی',
  salonId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  salonName: 'سالن زیبایی نگین',
  rating: 4,
  status: 'published' as const,
  reviewStatus: 'published' as const,
  createdAt: '2026-07-20T09:30:00.000Z',
}

describe('WorkerRatingsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads page 1 and renders the list as a table with a row per rating', async () => {
    fetchMock.mockResolvedValue({ data: { items: [rating], total: 1, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(WorkerRatingsView, mountOptions)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/worker-ratings?page=1&pageSize=10')
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.text()).toContain('آرش کریمی')
    expect(wrapper.text()).toContain('سالن زیبایی نگین')
    expect(wrapper.text()).toContain('4.0')
  })

  it('does not pass silent:true on the list fetch, so a validation failure surfaces distinctly', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(WorkerRatingsView, mountOptions)
    await flushPromises()

    // Called with just the URL -- no options object suppressing the default toast-on-error
    // behavior (a 400 from the backend's @IsUUID() validation must be visible, not collapse
    // into a silent, misleading empty result).
    expect(fetchMock).toHaveBeenCalledWith('/admin/worker-ratings?page=1&pageSize=10')
    const [, options] = fetchMock.mock.calls[0]!
    expect(options?.silent).not.toBe(true)
  })

  it('links the salon name in the table to its detail page', async () => {
    fetchMock.mockResolvedValue({ data: { items: [rating], total: 1, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(WorkerRatingsView, mountOptions)
    await flushPromises()

    const link = wrapper.findComponent(RouterLinkStub)
    expect(link.props('to')).toBe(`/salons/${rating.salonId}`)
    expect(link.text()).toBe(rating.salonName)
  })

  it('shows a loading indicator while the request is in flight', async () => {
    let resolveFetch!: (value: unknown) => void
    fetchMock.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve }))
    const wrapper = mount(WorkerRatingsView, mountOptions)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="table-loading"]').exists()).toBe(true)

    resolveFetch({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
    await flushPromises()
    expect(wrapper.find('[data-testid="table-loading"]').exists()).toBe(false)
  })

  it('sends the salonId and status filters and resets to page 1 on change', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(WorkerRatingsView, mountOptions)
    await flushPromises()

    wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'rejected')
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/admin/worker-ratings?page=1&pageSize=10&status=rejected')
  })

  it('does not double-fetch when a filter change resets an already-advanced page', async () => {
    fetchMock.mockResolvedValue({ data: { items: [rating], total: 40, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(WorkerRatingsView, mountOptions)
    await flushPromises()

    // Advance to page 2 first (one request).
    wrapper.findComponent(Pagination).vm.$emit('update:page', 2)
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/admin/worker-ratings?page=2&pageSize=10')

    fetchMock.mockClear()
    // A filter change while on page 2 resets to page 1 -- must fire exactly one request
    // (the page watcher's), not a second one from loadFromFilterChange calling load()
    // directly on top of it.
    wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'rejected')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenLastCalledWith('/admin/worker-ratings?page=1&pageSize=10&status=rejected')
  })

  // Both rows are 'rejected' on the rating itself; only the parent review's status says
  // whether that was an admin decision or the cascade of the customer deleting their own
  // review. The latter must read as a customer deletion and offer no republish button --
  // moderateWorkerRating() 409s on it, and one click would otherwise look like it
  // resurrected the rating into the worker's average.
  it('renders a customer-withdrawn parent as a deletion, with no moderation control', async () => {
    fetchMock.mockResolvedValue({
      data: {
        items: [
          { ...rating, id: 'wr-1', status: 'rejected', reviewStatus: 'rejected' },
          { ...rating, id: 'wr-2', status: 'rejected', reviewStatus: 'withdrawn' },
        ],
        total: 2,
        page: 1,
        pageSize: 10,
      },
      error: null,
    })
    const wrapper = mount(WorkerRatingsView, mountOptions)
    await flushPromises()

    const rows = wrapper.findAll('tbody tr')
    expect(rows[0]!.text()).toContain('رد شده')
    expect(rows[0]!.find('[data-testid="republish-worker-rating"]').exists()).toBe(true)

    expect(rows[1]!.text()).toContain('حذف شده توسط کاربر')
    expect(rows[1]!.find('[data-testid="withdrawn-notice"]').exists()).toBe(true)
    expect(rows[1]!.find('[data-testid="republish-worker-rating"]').exists()).toBe(false)
  })

  it('shows an empty state when nothing matches', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(WorkerRatingsView, mountOptions)
    await flushPromises()

    expect(wrapper.text()).toContain('امتیازی با این فیلترها یافت نشد.')
  })
})
