import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import BookingTimelineView from './BookingTimelineView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const BOOKING_ID = '11111111-1111-4111-8111-111111111111'

// A manual-approval booking that was requested, approved, paid and confirmed -- the shape
// the timeline exists to reconstruct.
const events = [
  {
    id: 'e1',
    bookingId: BOOKING_ID,
    eventType: 'BOOKING_CREATED',
    actorType: 'customer',
    actorId: 'u1',
    metadata: { confirmationMode: 'manual_approval', depositAmount: 50000 },
    createdAt: '2026-08-01T08:00:00.000Z',
  },
  {
    id: 'e2',
    bookingId: BOOKING_ID,
    eventType: 'APPROVAL_REQUESTED',
    actorType: 'customer',
    actorId: 'u1',
    metadata: { approvalTimeoutMinutes: 30, approvalExpiresAt: '2026-08-01T08:30:00.000Z' },
    createdAt: '2026-08-01T08:00:01.000Z',
  },
  {
    id: 'e3',
    bookingId: BOOKING_ID,
    eventType: 'SALON_APPROVED',
    actorType: 'salon_owner',
    actorId: 'u2',
    metadata: null,
    createdAt: '2026-08-01T08:10:00.000Z',
  },
  {
    id: 'e4',
    bookingId: BOOKING_ID,
    eventType: 'SLOT_RELEASED',
    actorType: 'system',
    actorId: null,
    metadata: { cause: 'approval_expired' },
    createdAt: '2026-08-01T08:31:00.000Z',
  },
]

async function mountWithRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/bookings/:id', name: 'booking-timeline', component: BookingTimelineView }],
  })
  router.push(`/bookings/${BOOKING_ID}`)
  await router.isReady()
  const wrapper = mount(BookingTimelineView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('BookingTimelineView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('renders every event oldest-first, in the order the backend returned them', async () => {
    fetchMock.mockResolvedValueOnce({ data: events, error: null })

    const wrapper = await mountWithRouter()

    expect(fetchMock).toHaveBeenCalledWith(`/admin/bookings/${BOOKING_ID}/events`, { silent: true })
    const rows = wrapper.findAll('[data-testid="timeline-event"]')
    expect(rows).toHaveLength(4)
    // Event types render through the Farsi label map, never as the raw SCREAMING_CASE enum.
    expect(rows[0]!.text()).toContain('ایجاد رزرو')
    expect(rows[1]!.text()).toContain('ارسال درخواست تایید')
    expect(rows[2]!.text()).toContain('تایید توسط آرایشگاه')
    expect(rows[3]!.text()).toContain('آزادسازی نوبت')
    expect(wrapper.text()).not.toContain('BOOKING_CREATED')
  })

  it('names the actor, showing the full actor id only when there is one', async () => {
    fetchMock.mockResolvedValueOnce({ data: events, error: null })

    const wrapper = await mountWithRouter()
    const rows = wrapper.findAll('[data-testid="timeline-event"]')

    expect(rows[2]!.text()).toContain('آرایشگاه‌دار')
    expect(rows[2]!.get('[data-testid="event-actor-id"]').text()).toBe('u2')
    // A cron-driven event genuinely has no human actor -- it must read as the system, and
    // no id line may be invented for it.
    expect(rows[3]!.text()).toContain('سامانه')
    expect(rows[3]!.find('[data-testid="event-actor-id"]').exists()).toBe(false)
  })

  it('renders metadata readably instead of as raw JSON', async () => {
    fetchMock.mockResolvedValueOnce({ data: events, error: null })

    const wrapper = await mountWithRouter()
    const rows = wrapper.findAll('[data-testid="timeline-event"]')

    const created = rows[0]!.get('[data-testid="event-metadata"]').text()
    expect(created).toContain('حالت تایید')
    expect(created).toContain('تایید دستی آرایشگاه')
    expect(created).toContain('مبلغ پیش‌پرداخت')
    expect(created).toContain('۵۰٬۰۰۰ تومان')
    expect(created).not.toContain('confirmationMode')

    const requested = rows[1]!.get('[data-testid="event-metadata"]').text()
    expect(requested).toContain('۳۰ دقیقه')
    // An ISO deadline renders as a fa-IR datetime, not as the raw string.
    expect(requested).not.toContain('2026-08-01T08:30:00.000Z')

    // An enum-valued cause goes through its own label map.
    expect(rows[3]!.get('[data-testid="event-metadata"]').text()).toContain('اتمام مهلت تایید')

    // No metadata at all: no empty block is rendered for it.
    expect(rows[2]!.find('[data-testid="event-metadata"]').exists()).toBe(false)
  })

  it('shows an unmapped metadata key rather than dropping it from the timeline', async () => {
    fetchMock.mockResolvedValueOnce({
      data: [{ ...events[0], metadata: { brandNewKey: 'مقدار تازه', flagged: true } }],
      error: null,
    })

    const wrapper = await mountWithRouter()
    const metadata = wrapper.get('[data-testid="event-metadata"]').text()

    expect(metadata).toContain('brandNewKey')
    expect(metadata).toContain('مقدار تازه')
    expect(metadata).toContain('بله')
  })

  it('shows a salon rejection reason as its own free text', async () => {
    fetchMock.mockResolvedValueOnce({
      data: [
        {
          ...events[0],
          id: 'e9',
          eventType: 'SALON_REJECTED',
          actorType: 'salon_owner',
          metadata: { reason: 'در آن ساعت آرایشگر در دسترس نیست' },
        },
      ],
      error: null,
    })

    const wrapper = await mountWithRouter()

    expect(wrapper.text()).toContain('رد توسط آرایشگاه')
    expect(wrapper.get('[data-testid="event-metadata"]').text()).toContain('در آن ساعت آرایشگر در دسترس نیست')
  })

  it('shows a loading state, then a retry-capable error state when the fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'boom' } })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/bookings/:id', name: 'booking-timeline', component: BookingTimelineView }],
    })
    router.push(`/bookings/${BOOKING_ID}`)
    await router.isReady()
    const wrapper = mount(BookingTimelineView, { global: { plugins: [router] } })

    expect(wrapper.find('[data-testid="timeline-loading"]').exists()).toBe(true)
    await flushPromises()

    expect(wrapper.find('[data-testid="timeline-error"]').exists()).toBe(true)
    // A failed fetch must never be repainted as "nothing ever happened to this booking".
    expect(wrapper.text()).not.toContain('رویدادی برای این رزرو ثبت نشده است')

    fetchMock.mockResolvedValueOnce({ data: events, error: null })
    await wrapper.get('[data-testid="timeline-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="timeline-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="timeline-event"]')).toHaveLength(4)
  })

  it('shows an empty state that points at the booking id when nothing came back', async () => {
    fetchMock.mockResolvedValueOnce({ data: [], error: null })

    const wrapper = await mountWithRouter()

    expect(wrapper.text()).toContain('رویدادی برای این رزرو ثبت نشده است؛ شناسه رزرو را بررسی کنید.')
    expect(wrapper.find('[data-testid="timeline-event"]').exists()).toBe(false)
  })
})
