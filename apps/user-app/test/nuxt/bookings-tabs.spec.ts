import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, type DOMWrapper } from '@vue/test-utils'
import BookingsListPage from '../../app/pages/bookings/index.vue'

// The «پیش‌رو / گذشته» split on the bookings list. useRoute/useRouter are mocked so ?tab= can
// be driven and the URL write-back observed; the rest mirrors bookings-list.spec.ts.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), { create: () => fetchStub })

let routeQuery: Record<string, string> = {}
// The real router (NuxtLink needs it), with only replace() observed.
let replaceMock: ReturnType<typeof vi.fn>
mockNuxtImport('useRoute', () => () => ({ params: {}, query: routeQuery, path: '/bookings' }))

const TERMS = { depositPercent: 20, depositMinToman: 200_000, cancellationWindowHours: 24 }
const base = { workerName: null, priceSnapshot: 300_000, depositAmount: 60_000, depositPaid: false, approvalExpiresAt: null, paymentExpiresAt: null }

const UPCOMING_CONFIRMED = { ...base, id: 'b-up', salonName: 'سالن آینده', serviceName: 'کوتاهی', startsAt: '2099-01-01T09:00:00.000Z', status: 'confirmed' }
const UPCOMING_REQUEST = {
  ...base,
  id: 'b-req',
  salonName: 'سالن درخواست',
  serviceName: 'رنگ',
  startsAt: '2098-06-01T09:00:00.000Z',
  status: 'pending_approval',
  approvalExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
}
const PAST_DONE = { ...base, id: 'b-done', salonName: 'سالن قبلی', serviceName: 'ابرو', startsAt: '2020-01-01T09:00:00.000Z', status: 'completed' }
// Confirmed, but its time is behind us: history, and never offered a reschedule the API would refuse.
const PAST_CONFIRMED = { ...base, id: 'b-old-conf', salonName: 'سالن دیروز', serviceName: 'براشینگ', startsAt: '2021-01-01T09:00:00.000Z', status: 'confirmed' }

function stub(bookings: unknown[]) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/bookings/mine') return bookings
    if (path === '/platform-config/booking-terms') return TERMS
    if (path === '/reviews/mine') return []
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

function panel(wrapper: Awaited<ReturnType<typeof mountSuspended>>, tab: 'upcoming' | 'past') {
  return wrapper.get(`[data-testid="bookings-panel-${tab}"]`)
}
function isShown(el: { attributes: (n: string) => string | undefined }) {
  return !(el.attributes('style') ?? '').includes('display: none')
}

describe('bookings list tabs', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    replaceMock = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(useRouter(), 'replace').mockImplementation(replaceMock as never)
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
    routeQuery = {}
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('splits the list into upcoming (soonest first) and past, with real counts', async () => {
    stub([UPCOMING_CONFIRMED, PAST_DONE, UPCOMING_REQUEST, PAST_CONFIRMED])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    const upcomingCards = panel(wrapper, 'upcoming').findAll('[data-testid="booking-card"]')
    expect(upcomingCards.map((c: DOMWrapper<Element>) => c.text().includes('سالن درخواست'))).toEqual([true, false])
    expect(panel(wrapper, 'past').findAll('[data-testid="booking-card"]')).toHaveLength(2)
    expect(wrapper.get('[data-testid="bookings-tab-upcoming"]').text()).toContain('۲')
    expect(wrapper.get('[data-testid="bookings-tab-past"]').text()).toContain('۲')
  })

  it('opens on «پیش‌رو» by default and marks it selected', async () => {
    stub([UPCOMING_CONFIRMED, PAST_DONE])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    expect(wrapper.get('[data-testid="bookings-tab-upcoming"]').attributes('aria-selected')).toBe('true')
    expect(isShown(panel(wrapper, 'upcoming'))).toBe(true)
    expect(isShown(panel(wrapper, 'past'))).toBe(false)
  })

  it('honours a deep link to ?tab=past', async () => {
    routeQuery = { tab: 'past' }
    stub([UPCOMING_CONFIRMED, PAST_DONE])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    expect(wrapper.get('[data-testid="bookings-tab-past"]').attributes('aria-selected')).toBe('true')
    expect(isShown(panel(wrapper, 'past'))).toBe(true)
    expect(isShown(panel(wrapper, 'upcoming'))).toBe(false)
  })

  it('falls back to «گذشته» when nothing is coming up but there is history', async () => {
    stub([PAST_DONE])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()
    expect(wrapper.get('[data-testid="bookings-tab-past"]').attributes('aria-selected')).toBe('true')
  })

  it('writes the chosen tab back into the URL', async () => {
    stub([UPCOMING_CONFIRMED, PAST_DONE])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    await wrapper.get('[data-testid="bookings-tab-past"]').trigger('click')
    expect(replaceMock).toHaveBeenCalledWith({ query: { tab: 'past' } })
  })

  it('shows the pending-approval countdown and no payment action on a request', async () => {
    stub([UPCOMING_REQUEST])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    const card = panel(wrapper, 'upcoming').get('[data-testid="booking-card"]')
    expect(card.get('[data-testid="pending-approval-strip"]').text()).toContain('مهلت پاسخ سالن')
    expect(card.find('[data-testid="remaining-time"]').exists()).toBe(true)
    expect(card.find('[data-testid="retry-payment-button"]').exists()).toBe(false)
  })

  it('does not offer a reschedule for a confirmed appointment whose time has already passed', async () => {
    stub([PAST_CONFIRMED, UPCOMING_CONFIRMED])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()

    expect(panel(wrapper, 'past').find('[data-testid="reschedule-booking-button"]').exists()).toBe(false)
    expect(panel(wrapper, 'upcoming').find('[data-testid="reschedule-booking-button"]').exists()).toBe(true)
  })

  it('shows an upcoming-specific empty state while history exists', async () => {
    routeQuery = { tab: 'upcoming' }
    stub([PAST_DONE])
    wrapper = await mountSuspended(BookingsListPage)
    await flushPromises()
    expect(panel(wrapper, 'upcoming').find('[data-testid="bookings-upcoming-empty"]').exists()).toBe(true)
  })
})
