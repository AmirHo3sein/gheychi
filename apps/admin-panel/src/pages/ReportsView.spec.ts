import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReportsView from './ReportsView.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import Pagination from '@/components/ui/Pagination.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const mountOptions = { global: { stubs: { RouterLink: RouterLinkStub } } }

const report = {
  id: 'r1',
  reason: 'اطلاعات این سالن واقعی نیست',
  status: 'open',
  salonId: 's1',
  salonName: 'سالن نمونه',
  reporterPhone: '09121234567',
  reviewId: null,
  reviewRating: null,
  reviewComment: null,
  targetType: 'salon',
  storyId: null,
  storyUrl: null,
  storyCaption: null,
  portfolioItemId: null,
  portfolioItemUrl: null,
  portfolioItemCaption: null,
  resolutionNote: null,
  createdAt: '2026-07-10T08:00:00.000Z',
}

describe('ReportsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads open reports by default, rendering reason, reporter, and a salon link', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...report }], total: 1, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/reports?status=open&page=1&pageSize=10', { silent: true })
    expect(wrapper.text()).toContain('اطلاعات این سالن واقعی نیست')
    expect(wrapper.text()).toContain('09121234567')
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/salons/s1')
    // Status renders through the Farsi label map.
    expect(wrapper.text()).toContain('باز')
  })

  it('quotes the reported review when the report targets a review', async () => {
    fetchMock.mockResolvedValue({
      data: {
        items: [{ ...report, targetType: 'review', reviewId: 'rev1', reviewRating: 1, reviewComment: 'برخورد بسیار بد بود' }],
        total: 1,
        page: 1,
        pageSize: 10,
      },
      error: null,
    })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="quoted-review"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="quoted-review"]').text()).toContain('برخورد بسیار بد بود')
  })

  it('gives a review-targeted report a deep link to the salon-scoped reviews queue, so an admin can reach the flagged content', async () => {
    fetchMock.mockResolvedValue({
      data: {
        items: [{ ...report, targetType: 'review', reviewId: 'rev1', reviewRating: 1, reviewComment: 'برخورد بسیار بد بود' }],
        total: 1,
        page: 1,
        pageSize: 10,
      },
      error: null,
    })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    const escalationLink = wrapper
      .findAllComponents(RouterLinkStub)
      .find((link) => link.attributes('data-testid') === 'review-escalation-link')
    expect(escalationLink?.props('to')).toBe('/reviews?salonId=s1')
  })

  it('does not render a review-escalation link for salon-targeted reports', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...report }], total: 1, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="review-escalation-link"]').exists()).toBe(false)
  })

  it('does not render any quoted content block for salon-targeted reports', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...report }], total: 1, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="quoted-review"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="quoted-story"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="quoted-portfolio-item"]').exists()).toBe(false)
  })

  it('shows the reported story thumbnail and caption when the row carries them', async () => {
    fetchMock.mockResolvedValue({
      data: {
        items: [
          { ...report, targetType: 'story', storyId: 'st1', storyUrl: 'http://cdn.example/story1.jpg', storyCaption: 'کوتاهی مو' },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      },
      error: null,
    })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    const quoted = wrapper.get('[data-testid="quoted-story"]')
    expect(quoted.get('img').attributes('src')).toBe('http://cdn.example/story1.jpg')
    expect(quoted.text()).toContain('کوتاهی مو')
    expect(quoted.text()).not.toContain('منقضی شده')
  })

  it('falls back to an expired placeholder when the reported story content is gone', async () => {
    // The real post-deletion shape: ON DELETE SET NULL nulled the storyId FK (provider
    // self-delete or expiry GC) and only targetType still says this targeted a story.
    fetchMock.mockResolvedValue({
      data: {
        items: [{ ...report, targetType: 'story', storyId: null, storyUrl: null, storyCaption: null }],
        total: 1,
        page: 1,
        pageSize: 10,
      },
      error: null,
    })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    const quoted = wrapper.get('[data-testid="quoted-story"]')
    expect(quoted.find('img').exists()).toBe(false)
    expect(quoted.text()).toContain('منقضی شده')
  })

  it('shows the reported portfolio item thumbnail and caption when the row carries them', async () => {
    fetchMock.mockResolvedValue({
      data: {
        items: [
          {
            ...report,
            targetType: 'portfolio',
            portfolioItemId: 'p1',
            portfolioItemUrl: 'http://cdn.example/work1.jpg',
            portfolioItemCaption: 'رنگ و مش',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      },
      error: null,
    })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    const quoted = wrapper.get('[data-testid="quoted-portfolio-item"]')
    expect(quoted.get('img').attributes('src')).toBe('http://cdn.example/work1.jpg')
    expect(quoted.text()).toContain('رنگ و مش')
  })

  it('falls back to an expired placeholder when the reported portfolio item is gone', async () => {
    // Same post-deletion shape as the story case: FK nulled, targetType survives.
    fetchMock.mockResolvedValue({
      data: {
        items: [{ ...report, targetType: 'portfolio', portfolioItemId: null, portfolioItemUrl: null, portfolioItemCaption: null }],
        total: 1,
        page: 1,
        pageSize: 10,
      },
      error: null,
    })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    const quoted = wrapper.get('[data-testid="quoted-portfolio-item"]')
    expect(quoted.find('img').exists()).toBe(false)
    expect(quoted.text()).toContain('منقضی شده')
  })

  it('reloads the list after a successful resolve, so the card leaves the open queue', async () => {
    // Dispatch by method/URL: the resolve flow makes three calls (list, PATCH, list again).
    let items: (typeof report)[] = [{ ...report }]
    fetchMock.mockImplementation((url: string, options?: { method?: string }) => {
      if (options?.method === 'PATCH' && url === '/admin/reports/r1') {
        items = [] // the backend now considers r1 resolved; the open queue is empty
        return Promise.resolve({ data: { id: 'r1', status: 'resolved' }, error: null })
      }
      return Promise.resolve({ data: { items, total: items.length, page: 1, pageSize: 10 }, error: null })
    })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    await wrapper.get('[data-testid="resolve-button"]').trigger('click')
    await wrapper.get('[data-testid="submit-resolution"]').trigger('click')
    await flushPromises()

    // The list was re-fetched after the action, keeping items/total truthful...
    const listCalls = fetchMock.mock.calls.filter(([url]) => (url as string).startsWith('/admin/reports?'))
    expect(listCalls).toHaveLength(2)
    // ...and the handled card is gone from the open queue.
    expect(wrapper.find('[data-testid="report-card"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('گزارشی با این وضعیت وجود ندارد.')
  })

  it('reloads the list when the PATCH fails (409 lost race), showing the winning state', async () => {
    fetchMock.mockImplementation((url: string, options?: { method?: string }) => {
      if (options?.method === 'PATCH') {
        return Promise.resolve({ data: null, error: { status: 409, message: 'این گزارش قبلاً رسیدگی شده است' } })
      }
      return Promise.resolve({ data: { items: [{ ...report }], total: 1, page: 1, pageSize: 10 }, error: null })
    })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    await wrapper.get('[data-testid="resolve-button"]').trigger('click')
    await wrapper.get('[data-testid="submit-resolution"]').trigger('click')
    await flushPromises()

    // The failed action still triggers a reload so the row reflects the winner's state.
    const listCalls = fetchMock.mock.calls.filter(([url]) => (url as string).startsWith('/admin/reports?'))
    expect(listCalls).toHaveLength(2)
    // The stale note panel collapsed instead of inviting a doomed retry.
    expect(wrapper.find('[data-testid="submit-resolution"]').exists()).toBe(false)
  })

  it('resets to page 1 with a single fetch when the filter changes from page > 1', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ data: { items: [{ ...report }], total: 25, page: 1, pageSize: 10 }, error: null }),
    )
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    wrapper.findComponent(Pagination).vm.$emit('update:page', 2)
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('/admin/reports?status=open&page=2&pageSize=10', { silent: true })

    fetchMock.mockClear()
    wrapper.findComponent(AppSelect).vm.$emit('update:modelValue', 'resolved')
    await flushPromises()

    // Exactly ONE request: the page reset rides along with the filter change,
    // not as a second duplicate fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/admin/reports?status=resolved&page=1&pageSize=10', { silent: true })
  })

  it('shows an empty state when the queue is clear', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    expect(wrapper.text()).toContain('گزارشی با این وضعیت وجود ندارد.')
  })

  it('shows a loading indicator while the initial fetch is in flight', async () => {
    let resolveFetch!: (value: { data: { items: never[]; total: number; page: number; pageSize: number }; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = mount(ReportsView, mountOptions)

    expect(wrapper.find('[data-testid="reports-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="reports-error"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('گزارشی با این وضعیت وجود ندارد.')

    resolveFetch({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
    await flushPromises()

    expect(wrapper.find('[data-testid="reports-loading"]').exists()).toBe(false)
  })

  it('shows a distinct error state with retry when the fetch fails, instead of reading as an empty queue', async () => {
    fetchMock.mockResolvedValue({ data: null, error: { status: 500, message: 'Internal error' } })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="reports-error"]').exists()).toBe(true)
    // A silently-broken queue must never render as a truthful "all clear" empty state.
    expect(wrapper.text()).not.toContain('گزارشی با این وضعیت وجود ندارد.')

    fetchMock.mockResolvedValue({ data: { items: [{ ...report }], total: 1, page: 1, pageSize: 10 }, error: null })
    await wrapper.get('[data-testid="reports-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="reports-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="report-card"]').exists()).toBe(true)
  })
})
