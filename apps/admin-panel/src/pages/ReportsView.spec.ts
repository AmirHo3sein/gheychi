import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReportsView from './ReportsView.vue'

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
        items: [{ ...report, reviewId: 'rev1', reviewRating: 1, reviewComment: 'برخورد بسیار بد بود' }],
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

  it('does not render a quoted review block for salon-targeted reports', async () => {
    fetchMock.mockResolvedValue({ data: { items: [{ ...report }], total: 1, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="quoted-review"]').exists()).toBe(false)
  })

  it('updates the card status in place after a resolve', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: { items: [{ ...report }], total: 1, page: 1, pageSize: 10 }, error: null })
      .mockResolvedValueOnce({ data: { id: 'r1', status: 'resolved' }, error: null })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    await wrapper.get('[data-testid="resolve-button"]').trigger('click')
    await wrapper.get('[data-testid="submit-resolution"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('رسیدگی شده')
    // A non-open report offers no further actions.
    expect(wrapper.find('[data-testid="resolve-button"]').exists()).toBe(false)
  })

  it('shows an empty state when the queue is clear', async () => {
    fetchMock.mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 10 }, error: null })
    const wrapper = mount(ReportsView, mountOptions)
    await flushPromises()

    expect(wrapper.text()).toContain('گزارشی با این وضعیت وجود ندارد.')
  })
})
