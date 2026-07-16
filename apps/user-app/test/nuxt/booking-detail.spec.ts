import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import BookingDetailPage from '../../app/pages/bookings/[id].vue'

// Same pattern as booking-confirm.spec.ts: `$fetch` is a real globalThis binding,
// not an unimport-tracked auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

mockNuxtImport('useRoute', () => () => ({ params: { id: 'b1' } }))

const BASE_BOOKING = {
  id: 'b1',
  salonName: 'Test Salon',
  serviceName: 'Haircut',
  startsAt: '2026-07-20T09:00:00.000Z',
  priceSnapshot: 300_000,
  depositAmount: 200_000,
  status: 'cancelled_by_salon',
  refundStatus: null as string | null,
}

describe('booking detail page refund line', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
    clearNuxtData('booking-detail-b1')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the in-progress line while the refund is pending', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, refundStatus: 'pending' })
    wrapper = await mountSuspended(BookingDetailPage)
    expect(wrapper.text()).toContain('بازگشت وجه در حال انجام است')
  })

  it('shows the completed line once the refund is done', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, refundStatus: 'done' })
    wrapper = await mountSuspended(BookingDetailPage)
    expect(wrapper.text()).toContain('وجه بازگردانده شد')
    expect(wrapper.text()).not.toContain('در حال انجام')
  })

  it('shows no refund line when there is no refund in play', async () => {
    fetchMock.mockResolvedValue({ ...BASE_BOOKING, refundStatus: null })
    wrapper = await mountSuspended(BookingDetailPage)
    expect(wrapper.text()).not.toContain('بازگشت وجه')
    expect(wrapper.text()).not.toContain('بازگردانده')
  })
})
