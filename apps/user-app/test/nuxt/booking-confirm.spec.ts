import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import BookingConfirmPage from '../../app/pages/booking/[slug]/[serviceId].vue'
import SlotPicker from '../../app/components/booking/SlotPicker.vue'

// Same pattern as useApi.spec.ts / SlotPicker.spec.ts: `$fetch` is a real globalThis
// binding, not an unimport-tracked auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

// The page reads slug/serviceId from the route params -- mockNuxtImport lets us pin
// them to fixed test values regardless of where the spec file lives.
mockNuxtImport('useRoute', () => () => ({ params: { slug: 'test-salon', serviceId: 'svc-1' } }))

const SALON = { id: 'salon-1', name: 'Test Salon', address: 'Somewhere St' }
const SERVICE = { id: 'svc-1', name: 'Haircut', price: 300_000, durationMin: 30 }
const TERMS = { depositPercent: 20, depositMinToman: 200_000, cancellationWindowHours: 24 }
const SLOT_ISO = '2026-07-10T09:00:00.000Z'

function stubPageLoad(bookingsBehavior: 'success' | { rejectWith: unknown }) {
  fetchMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === '/salons/test-salon') return SALON
    if (path === '/salons/test-salon/services') return [SERVICE]
    if (path === '/platform-config/booking-terms') return TERMS
    if (path === `/salons/${SALON.id}/availability`) return []
    if (path === '/bookings' && opts?.method === 'POST') {
      if (bookingsBehavior === 'success') return { booking: { id: 'b1' }, paymentUrl: 'http://gateway.example/pay' }
      throw bookingsBehavior.rejectWith
    }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('booking confirm page', () => {
  // mountSuspended shares one Nuxt app instance across tests in this file, and every test
  // here uses the same fixed slug/serviceId route params -- so without unmounting +
  // clearing the cache, a later test's mount can silently reuse an earlier test's cached
  // `booking-test-salon-svc-1` useAsyncData payload instead of re-fetching. Same pattern as
  // blog-article.spec.ts.
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
    clearNuxtData('booking-test-salon-svc-1')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a deposit estimate matching calculateDeposit()\'s formula (max(price*percent/100, minToman))', async () => {
    stubPageLoad('success')
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()

    // calculateDeposit(300_000, 20, 200_000) => max(round(300_000 * 20 / 100), 200_000) = 200_000
    const expectedDeposit = Math.max(Math.round((SERVICE.price * TERMS.depositPercent) / 100), TERMS.depositMinToman)
    expect(expectedDeposit).toBe(200_000)
    expect(wrapper.text()).toContain(expectedDeposit.toLocaleString('fa-IR'))
  })

  it('on a 409 from POST /bookings, shows the conflict message and clears the selected slot', async () => {
    stubPageLoad({ rejectWith: { response: { status: 409 } } })
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()

    await wrapper.find('[data-testid="confirm-booking-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('این نوبت همین الان رزرو شد')
    // The confirm sheet is only rendered while a slot is selected -- asserting it's gone
    // confirms selectedSlot was actually reset to null, not just that the message showed.
    expect(wrapper.find('[data-testid="confirm-booking-button"]').exists()).toBe(false)
  })

  it('throws the standard 404 for an unknown salon/service pair', async () => {
    fetchMock.mockImplementation(async () => {
      // Shape matches how ofetch surfaces an HTTP error response.
      throw { response: { status: 404 } }
    })

    await expect(mountSuspended(BookingConfirmPage)).rejects.toMatchObject({ statusCode: 404 })
  })
})
