import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, type DOMWrapper } from '@vue/test-utils'
import BookingDetailPage from '../../app/pages/bookings/[id].vue'

// Wave-2 additions to the booking detail page: the one-time success moment (?created=1), the
// .ics calendar file, and the salon "how to reach them" card that renders only from fields
// the API actually sent. Same stubbing pattern as booking-detail.spec.ts, with a mutable query.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), { create: () => fetchStub })

let routeQuery: Record<string, string> = {}
// The real router (NuxtLink needs it), with only replace() observed.
let replaceMock: ReturnType<typeof vi.fn>
mockNuxtImport('useRoute', () => () => ({ params: { id: 'b1' }, query: routeQuery }))

const FUTURE_START = '2099-05-01T11:30:00.000Z'
const FUTURE_END = '2099-05-01T12:15:00.000Z'

const BOOKING = {
  id: 'b1',
  salonName: 'سالن نمونه',
  serviceName: 'کوتاهی مو',
  workerName: 'عضو ۱',
  startsAt: FUTURE_START,
  endsAt: FUTURE_END,
  priceSnapshot: 300_000,
  depositAmount: 60_000,
  walletAmountUsed: null,
  status: 'confirmed',
  refundStatus: null,
  confirmationMode: 'automatic',
  approvalExpiresAt: null,
  paymentExpiresAt: null,
  depositPaid: false,
}

function stub(booking: unknown) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/bookings/b1') return booking
    if (path === '/reviews/mine') return []
    if (path === '/platform-config/booking-terms') return { cancellationWindowHours: 24 }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('booking detail -- wave 2 additions', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    replaceMock = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(useRouter(), 'replace').mockImplementation(replaceMock as never)
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
    routeQuery = {}
    clearNuxtData(['booking-detail-b1', 'booking-review-b1'])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('greets an arrival from the booking flow once, with the «done» mascot, and drops the flag from the URL', async () => {
    routeQuery = { created: '1' }
    stub(BOOKING)
    wrapper = await mountSuspended(BookingDetailPage)
    await flushPromises()

    const banner = wrapper.get('[data-testid="booking-created-banner"]')
    expect(banner.text()).toContain('نوبت شما ثبت شد')
    expect(banner.get('img').attributes('src')).toBe('/mascot/done.webp')
    expect(replaceMock).toHaveBeenCalledWith({ query: {} })
  })

  it('calls a manual-approval arrival a request, not a booking', async () => {
    routeQuery = { created: '1' }
    stub({ ...BOOKING, status: 'pending_approval', confirmationMode: 'manual_approval', approvalExpiresAt: new Date(Date.now() + 600_000).toISOString() })
    wrapper = await mountSuspended(BookingDetailPage)
    await flushPromises()

    expect(wrapper.get('[data-testid="booking-created-banner"]').text()).toContain('درخواست رزرو شما ارسال شد')
  })

  it('shows no success banner on an ordinary visit', async () => {
    stub(BOOKING)
    wrapper = await mountSuspended(BookingDetailPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="booking-created-banner"]').exists()).toBe(false)
    expect(replaceMock).not.toHaveBeenCalledWith({ query: {} })
  })

  it('offers «افزودن به تقویم» for a confirmed upcoming booking and downloads a UTC .ics', async () => {
    stub(BOOKING)
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
      blobs.push(b as Blob)
      return 'blob:ics'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    wrapper = await mountSuspended(BookingDetailPage)
    await flushPromises()
    await wrapper.get('[data-testid="add-to-calendar-button"]').trigger('click')

    expect(click).toHaveBeenCalled()
    const text = (await blobs[0]!.text()).replace(/\r\n /g, '')
    expect(text).toContain('DTSTART:20990501T113000Z')
    expect(text).toContain('DTEND:20990501T121500Z')
    expect(text).toContain('SUMMARY:کوتاهی مو — سالن نمونه')
    // The placeholder worker name never leaks into the calendar either.
    expect(text).not.toContain('عضو ۱')
  })

  it('does not offer a calendar file for a request still awaiting the salon', async () => {
    stub({ ...BOOKING, status: 'pending_approval' })
    wrapper = await mountSuspended(BookingDetailPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="add-to-calendar-button"]').exists()).toBe(false)
  })

  it('shows the worker as «متخصص سالن» when the owner typed a placeholder name', async () => {
    stub(BOOKING)
    wrapper = await mountSuspended(BookingDetailPage)
    await flushPromises()
    expect(wrapper.text()).toContain('متخصص: متخصص سالن')
    expect(wrapper.text()).not.toContain('عضو ۱')
  })

  it('renders the salon card only from fields the API sent: directions + tel link', async () => {
    stub({ ...BOOKING, salonAddress: 'تهران، خیابان ولیعصر', salonLocation: { type: 'Point', coordinates: [51.389, 35.6892] }, salonContactPhone: '02112345678' })
    wrapper = await mountSuspended(BookingDetailPage)
    await flushPromises()

    expect(wrapper.get('[data-testid="booking-salon-address"]').text()).toContain('خیابان ولیعصر')
    const links = wrapper.get('[data-testid="booking-directions"]').findAll('a').map((a: DOMWrapper<Element>) => a.attributes('href'))
    expect(links).toEqual(['https://nshn.ir/?lat=35.6892&lng=51.389', 'https://www.google.com/maps/dir/?api=1&destination=35.6892,51.389'])
    expect(wrapper.get('[data-testid="booking-salon-contact"]').attributes('href')).toBe('tel:02112345678')
  })

  it('renders no salon card at all when the API sent none of those fields', async () => {
    stub(BOOKING)
    wrapper = await mountSuspended(BookingDetailPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="booking-salon-card"]').exists()).toBe(false)
  })
  it('withdraws the calendar action and the «booked» banner once the booking is cancelled on this page', async () => {
    routeQuery = { created: '1' }
    let current: Record<string, unknown> = { ...BOOKING }
    fetchMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/bookings/b1') return current
      if (path === '/bookings/b1/cancel' && opts?.method === 'POST') {
        current = { ...BOOKING, status: 'cancelled_by_user' }
        return {}
      }
      if (path === '/reviews/mine') return []
      if (path === '/platform-config/booking-terms') return { cancellationWindowHours: 24 }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    wrapper = await mountSuspended(BookingDetailPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="add-to-calendar-button"]').exists()).toBe(true)

    await wrapper.get('[data-testid="cancel-booking-button"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="cancel-confirm-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="booking-status-badge"]').text()).toContain('لغو شده توسط شما')
    expect(wrapper.find('[data-testid="add-to-calendar-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="booking-created-banner"]').exists()).toBe(false)
  })

  it('offers the calendar file after a failed first load is retried successfully', async () => {
    let fail = true
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/bookings/b1') {
        if (fail) throw { response: { status: 503 } }
        return BOOKING
      }
      if (path === '/reviews/mine') return []
      if (path === '/platform-config/booking-terms') return { cancellationWindowHours: 24 }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    wrapper = await mountSuspended(BookingDetailPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="booking-detail-load-error"]').exists()).toBe(true)

    fail = false
    await wrapper.get('[data-testid="booking-detail-retry-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="add-to-calendar-button"]').exists()).toBe(true)
  })
})
