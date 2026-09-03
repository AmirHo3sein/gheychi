import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import BookingsView from './BookingsView.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import Pagination from '@/components/ui/Pagination.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

// The page reads route.query so another screen can deep-link into a pre-filtered list.
const routeQuery = ref<Record<string, string>>({})
vi.mock('vue-router', () => ({ useRoute: () => ({ query: routeQuery.value }) }))

const mountOptions = { global: { stubs: { RouterLink: RouterLinkStub } } }

const SALON_ID = '22222222-2222-4222-8222-222222222222'
const BOOKING_ID = '11111111-1111-4111-8111-111111111111'

const paidBooking = {
  id: BOOKING_ID,
  startsAt: '2026-09-01T09:00:00.000Z',
  endsAt: '2026-09-01T10:00:00.000Z',
  status: 'completed',
  confirmationMode: 'automatic',
  source: 'online',
  attributionSource: 'qr',
  priceSnapshot: 1_000_000,
  depositAmount: 200_000,
  createdAt: '2026-08-30T09:00:00.000Z',
  salonId: SALON_ID,
  salonName: 'سالن نمونه',
  serviceId: 'service-1',
  serviceName: 'کوتاهی مو',
  workerId: 'worker-1',
  workerName: 'مریم',
  userId: 'user-1',
  customerName: 'زهرا',
  customerPhone: '09120000001',
  payment: {
    status: 'refund_pending',
    amount: 200_000,
    paidAt: '2026-08-30T09:05:00.000Z',
    refundRequestedAt: '2026-08-31T10:00:00.000Z',
    refundedAt: null,
    refundRefId: null,
  },
  commissionAmount: 20_000,
}

const manualBooking = {
  ...paidBooking,
  id: '33333333-3333-4333-8333-333333333333',
  status: 'pending_approval',
  confirmationMode: 'manual_approval',
  source: 'manual',
  attributionSource: null,
  workerId: null,
  workerName: null,
  customerName: 'مشتری حضوری',
  customerPhone: '09120000002',
  payment: null,
  commissionAmount: null,
}

function respondWith(items: unknown[], total = items.length) {
  fetchMock.mockResolvedValue({ data: { items, total, page: 1, pageSize: 20 }, error: null })
}

describe('BookingsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    routeQuery.value = {}
  })

  it('loads the unfiltered list and renders customer, salon, service, money and payment state', async () => {
    respondWith([paidBooking])
    const wrapper = mount(BookingsView, mountOptions)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/bookings?page=1&pageSize=20', { silent: true })
    const text = wrapper.text()
    expect(text).toContain('زهرا')
    expect(text).toContain('09120000001')
    expect(text).toContain('سالن نمونه')
    expect(text).toContain('کوتاهی مو')
    expect(text).toContain('مریم')
    expect(text).toContain('انجام شده')
    // The dispute-triage signal: a payment still owing a refund.
    expect(text).toContain('در انتظار استرداد')
    expect(text).toContain('کد QR')
  })

  it('renders a booking with no payment row as "بدون پرداخت آنلاین" and a dashed commission, never as zero toman', async () => {
    // pending_approval bookings genuinely have no Payment row; showing "۰ تومان" would
    // read as "paid nothing", which is a different and wrong fact.
    respondWith([manualBooking])
    const wrapper = mount(BookingsView, mountOptions)
    await flushPromises()

    expect(wrapper.get('[data-testid="no-payment"]').text()).toBe('بدون پرداخت آنلاین')
    expect(wrapper.text()).toContain('ثبت توسط آرایشگاه')
    // The commission cell (last numeric column) shows an em dash for "no ledger row",
    // never a formatted zero.
    const cells = wrapper.get('[data-testid="booking-row"]').findAll('td')
    expect(cells[7].text()).toBe('—')
  })

  it('links each row to that booking\'s timeline, finally making BookingTimelineView reachable', async () => {
    respondWith([paidBooking])
    const wrapper = mount(BookingsView, mountOptions)
    await flushPromises()

    const link = wrapper.getComponent(RouterLinkStub)
    expect(link.props('to')).toEqual({ name: 'booking-timeline', params: { id: BOOKING_ID } })
  })

  it('applies a select filter and resets to page 1', async () => {
    respondWith([paidBooking])
    const wrapper = mount(BookingsView, mountOptions)
    await flushPromises()

    const paymentSelect = wrapper.get('[data-testid="payment-status-filter"]').getComponent(AppSelect)
    await paymentSelect.setValue('refund_pending')
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/admin/bookings?page=1&pageSize=20&paymentStatus=refund_pending',
      { silent: true },
    )
  })

  it('pre-fills the salon filter from the query string, so another screen can deep-link into it', async () => {
    routeQuery.value = { salonId: SALON_ID }
    respondWith([paidBooking])
    mount(BookingsView, mountOptions)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(`/admin/bookings?page=1&pageSize=20&salonId=${SALON_ID}`, { silent: true })
  })

  it('never sends a half-typed id, since the backend 400s anything that is not a real UUID', async () => {
    routeQuery.value = { salonId: 'not-a-uuid' }
    respondWith([paidBooking])
    mount(BookingsView, mountOptions)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/bookings?page=1&pageSize=20', { silent: true })
  })

  it('paginates, requesting the next page while keeping the active filters', async () => {
    respondWith([paidBooking], 45)
    const wrapper = mount(BookingsView, mountOptions)
    await flushPromises()

    wrapper.getComponent(Pagination).vm.$emit('update:page', 2)
    await flushPromises()

    expect(fetchMock).toHaveBeenLastCalledWith('/admin/bookings?page=2&pageSize=20', { silent: true })
  })

  it('shows the empty state when nothing matches', async () => {
    respondWith([])
    const wrapper = mount(BookingsView, mountOptions)
    await flushPromises()

    expect(wrapper.text()).toContain('رزروی با این فیلترها یافت نشد.')
    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
  })

  it('shows a distinct error state (not the empty state) when the fetch fails, and retry reloads', async () => {
    // "No bookings match" is a conclusion an operator would act on mid-dispute, so a
    // failed request must never be repainted as one.
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'boom' } })
    const wrapper = mount(BookingsView, mountOptions)
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('رزروی با این فیلترها یافت نشد.')

    respondWith([paidBooking])
    await wrapper.get('[data-testid="retry-load"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('زهرا')
  })

  it('drops a slow earlier response so it cannot overwrite a newer one', async () => {
    // Request 1 (initial load) resolves LAST, with stale data. Without the request-sequence
    // guard the table would flip back to the pre-filter rows after the filter had applied.
    let resolveFirst!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    const wrapper = mount(BookingsView, mountOptions)
    await flushPromises()

    fetchMock.mockResolvedValue({ data: { items: [manualBooking], total: 1, page: 1, pageSize: 20 }, error: null })
    const paymentSelect = wrapper.get('[data-testid="payment-status-filter"]').getComponent(AppSelect)
    await paymentSelect.setValue('paid')
    await flushPromises()
    expect(wrapper.text()).toContain('مشتری حضوری')

    resolveFirst({ data: { items: [paidBooking], total: 1, page: 1, pageSize: 20 }, error: null })
    await flushPromises()

    expect(wrapper.text()).toContain('مشتری حضوری')
    expect(wrapper.text()).not.toContain('زهرا')
  })
})
