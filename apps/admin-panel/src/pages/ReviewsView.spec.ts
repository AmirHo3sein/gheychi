import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewsView from './ReviewsView.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import Pagination from '@/components/ui/Pagination.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const publishedReview = {
  id: 'r1',
  salonId: 's1',
  salonName: 'سالن نمونه',
  rating: 4,
  comment: 'تجربه خوبی بود',
  status: 'published',
  salonReply: null,
  createdAt: '2026-07-10T08:00:00.000Z',
  workerRating: null,
}

const withdrawnReview = {
  ...publishedReview,
  id: 'r2',
  status: 'withdrawn',
  comment: 'این نظر حذف شده است',
}

describe('ReviewsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads reviews and renders salon name, formatted date, and status label on each card', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...publishedReview }], total: 1, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(ReviewsView)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/reviews?page=1&pageSize=10', { silent: true })
    expect(wrapper.text()).toContain('سالن نمونه')
    expect(wrapper.text()).toContain('منتشر شده')
    // fa-IR Intl.DateTimeFormat's Jalali rendering of the fixture's createdAt (2026-07-10).
    expect(wrapper.text()).toContain('تیر')
  })

  it('filters by salon NAME (not a raw salon id) via the salonName query param', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(ReviewsView)
    await flushPromises()
    fetchMock.mockClear()

    await wrapper.get('input').setValue('سالن نمونه')
    // Salon-name input is debounced (350ms) -- advance real time rather than mocking
    // timers, to keep this test resilient to an implementation-detail delay change.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/reviews?page=1&pageSize=10&salonName=%D8%B3%D8%A7%D9%84%D9%86+%D9%86%D9%85%D9%88%D9%86%D9%87', {
      silent: true,
    })
  })

  it('shows a loading indicator while the initial fetch is in flight, and hides it after', async () => {
    let resolveFetch!: (value: { data: { items: never[]; total: number; page: number; pageSize: number }; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = mount(ReviewsView)

    expect(wrapper.find('[data-testid="reviews-loading"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('نظری با این فیلترها یافت نشد.')

    resolveFetch({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
    await flushPromises()

    expect(wrapper.find('[data-testid="reviews-loading"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('نظری با این فیلترها یافت نشد.')
  })

  it('shows a loading indicator again on a filter/page change', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...publishedReview }], total: 25, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(ReviewsView)
    await flushPromises()
    expect(wrapper.find('[data-testid="reviews-loading"]').exists()).toBe(false)

    let resolveFetch!: (value: { data: { items: never[]; total: number; page: number; pageSize: number }; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    wrapper.findComponent(Pagination).vm.$emit('update:page', 2)
    await flushPromises()

    expect(wrapper.find('[data-testid="reviews-loading"]').exists()).toBe(true)

    resolveFetch({ data: { items: [], total: 0, page: 2, pageSize: 10 }, error: null })
    await flushPromises()
    expect(wrapper.find('[data-testid="reviews-loading"]').exists()).toBe(false)
  })

  // P0 regression coverage: a withdrawn (customer self-deleted) review must never be
  // presented with the same actionable moderation controls as a rejected one.
  describe('withdrawn review handling (P0 -- customer self-deletion is not admin moderation)', () => {
    it('labels a withdrawn review distinctly from "rejected", not as a raw/neutral fallback', async () => {
      fetchMock.mockResolvedValue({ data: { items: [{ ...withdrawnReview }], total: 1, page: 1, pageSize: 10 }, error: null })
      const wrapper = mount(ReviewsView)
      await flushPromises()

      expect(wrapper.text()).toContain('حذف شده توسط کاربر')
      expect(wrapper.text()).not.toContain('رد شده')
    })

    it('renders no republish/reject control for a withdrawn review -- only the non-actionable notice', async () => {
      fetchMock.mockResolvedValue({ data: { items: [{ ...withdrawnReview }], total: 1, page: 1, pageSize: 10 }, error: null })
      const wrapper = mount(ReviewsView)
      await flushPromises()

      expect(wrapper.find('[data-testid="republish-review"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="reject-review"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="withdrawn-notice"]').exists()).toBe(true)
    })

    it('a mixed page (withdrawn + published) only offers moderation controls on the actionable row', async () => {
      fetchMock.mockResolvedValue({
        data: { items: [{ ...publishedReview }, { ...withdrawnReview }], total: 2, page: 1, pageSize: 10 },
        error: null,
      })
      const wrapper = mount(ReviewsView)
      await flushPromises()

      expect(wrapper.findAll('[data-testid="reject-review"]')).toHaveLength(1)
      expect(wrapper.findAll('[data-testid="republish-review"]')).toHaveLength(0)
      expect(wrapper.findAll('[data-testid="withdrawn-notice"]')).toHaveLength(1)
    })
  })

  it('clears an active status filter on the clear-filters action, reloading with no stale params', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(ReviewsView)
    await flushPromises()

    // AppSelect's watcher is immediate (unlike the debounced salon-name input), so this
    // alone is enough to exercise clearFilters() without a pending real-timer debounce
    // left dangling past the end of the test.
    wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'rejected')
    await flushPromises()

    expect(wrapper.text()).toContain('پاک کردن فیلترها')
    fetchMock.mockClear()

    await wrapper.get('[type="button"]').trigger('click')
    await flushPromises()

    const lastCall = fetchMock.mock.calls.at(-1)?.[0] as string
    expect(lastCall).not.toContain('status=')
  })

  it('shows a distinct error state (not the empty state) when the fetch fails, and retry reloads', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'Something went wrong' } })
    const wrapper = mount(ReviewsView)
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('نظری با این فیلترها یافت نشد.')

    fetchMock.mockResolvedValueOnce({ data: { items: [{ ...publishedReview }], total: 1, page: 1, pageSize: 10 }, error: null })
    await wrapper.get('[data-testid="retry-load"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('سالن نمونه')
  })
})
