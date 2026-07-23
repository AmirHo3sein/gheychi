import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, type DOMWrapper } from '@vue/test-utils'
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

function stubPageLoad(
  bookingsBehavior: 'success' | { rejectWith: unknown },
  couponValidateResponse?: unknown,
) {
  fetchMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === '/salons/test-salon') return SALON
    if (path === '/salons/test-salon/services') return [SERVICE]
    if (path === '/platform-config/booking-terms') return TERMS
    if (path === `/salons/${SALON.id}/availability`) return []
    if (path === '/coupons/validate' && opts?.method === 'POST') return couponValidateResponse
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

  // Slice 6 (fixed-amount coupon discounts): apps/api/src/coupons/coupon-validation.controller.ts's
  // POST /coupons/validate response is discount-kind-aware -- these two tests pin the UI's
  // reaction to each kind winning, per docs/superpowers/specs/2026-07-21-referral-and-rating-system-design.md §3.
  it('shows the savings amount AND a percent badge when a percent-kind coupon wins', async () => {
    stubPageLoad('success', {
      valid: true,
      couponDiscountPercent: 30,
      couponDiscountKind: 'percent',
      couponDiscountValue: 30,
      serviceDiscountPercent: null,
      appliedDiscountPercent: 30,
      originalPrice: 300_000,
      finalPrice: 210_000,
      estimatedDeposit: 200_000,
    })
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()
    await wrapper.find('input').setValue('SAVE30')
    await wrapper.findAll('button').find((b: DOMWrapper<Element>) => b.text() === 'اعمال')!.trigger('click')
    await flushPromises()

    // Savings amount: originalPrice - finalPrice = 90,000
    expect(wrapper.text()).toContain('شما')
    expect(wrapper.text()).toContain((90_000).toLocaleString('fa-IR'))
    expect(wrapper.text()).toContain('صرفه‌جویی کردید')
    // The percent badge is legitimate here since the WINNER was percent-kind.
    expect(wrapper.text()).toContain('٪' + (30).toLocaleString('fa-IR'))
  })

  it('shows the savings amount but NO percent badge when a fixed-toman coupon wins (never fabricates a percent)', async () => {
    stubPageLoad('success', {
      valid: true,
      couponDiscountPercent: null,
      couponDiscountKind: 'fixed',
      couponDiscountValue: 50_000,
      serviceDiscountPercent: null,
      appliedDiscountPercent: undefined,
      originalPrice: 300_000,
      finalPrice: 250_000,
      estimatedDeposit: 200_000,
    })
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()
    await wrapper.find('input').setValue('SAVE50K')
    await wrapper.findAll('button').find((b: DOMWrapper<Element>) => b.text() === 'اعمال')!.trigger('click')
    await flushPromises()

    // Savings amount: originalPrice - finalPrice = 50,000, always correct regardless of kind.
    expect(wrapper.text()).toContain('شما')
    expect(wrapper.text()).toContain((50_000).toLocaleString('fa-IR'))
    expect(wrapper.text()).toContain('صرفه‌جویی کردید')
    // No percent badge anywhere in the discount area -- must not fabricate a percent
    // equivalent of a fixed-toman win. '٪' only ever appears in that badge (the coupon
    // input's own label/placeholder use the word "تخفیف" without a percent sign, so
    // asserting on '٪' specifically avoids a false failure from those).
    expect(wrapper.text()).not.toContain('٪')
  })

  // Product Principle #3 (a booking's financial commitment must never feel hidden or
  // ambiguous) -- the page must disclose what happens AFTER the free-cancellation window,
  // not just the positive "free cancel until X" case.
  it('discloses that the deposit is non-refundable after the cancellation window', async () => {
    stubPageLoad('success')
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()

    expect(wrapper.text()).toContain(`لغو رایگان تا ${TERMS.cancellationWindowHours} ساعت قبل از نوبت`)
    expect(wrapper.text()).toContain('پیش‌پرداخت قابل بازگشت نیست')
  })

  // Design-system migration: the pay button is BaseButton (not a hand-rolled <button>) and
  // the price/coupon panel is BaseCard -- both give the "One Seal Rule" (only the pay
  // button is accent-colored) and WCAG-contrast fixes for free, so pinning their presence
  // guards against a future regression back to the hand-rolled markup.
  it('renders the pay action as BaseButton in its loading state while submitting', async () => {
    // The /bookings POST intentionally never resolves within this test -- it only needs to
    // stay in-flight long enough to assert the loading state; nothing downstream of it is
    // exercised here, so an unresolved promise is simplest.
    fetchMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/salons/test-salon') return SALON
      if (path === '/salons/test-salon/services') return [SERVICE]
      if (path === '/platform-config/booking-terms') return TERMS
      if (path === `/salons/${SALON.id}/availability`) return []
      if (path === '/bookings' && opts?.method === 'POST') return new Promise(() => {})
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()

    const payButton = wrapper.find('[data-testid="confirm-booking-button"]')
    expect(payButton.attributes('aria-busy')).toBe('false')

    await payButton.trigger('click')
    await nextTick()

    expect(payButton.attributes('aria-busy')).toBe('true')
    expect(payButton.attributes('disabled')).toBeDefined()
  })

  // A11y: the three dynamic status regions (coupon error, coupon success, submit error)
  // must announce to screen readers, not just change visually.
  it('marks the submit-error message as an assertive live region', async () => {
    stubPageLoad({ rejectWith: { response: { status: 409 } } })
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()
    await wrapper.find('[data-testid="confirm-booking-button"]').trigger('click')
    await flushPromises()

    const alertEl = wrapper.findAll('[role="alert"]').find((el: DOMWrapper<Element>) => el.text().includes('این نوبت همین الان رزرو شد'))
    expect(alertEl).toBeTruthy()
    expect(alertEl!.attributes('aria-live')).toBe('assertive')
  })

  it('marks the coupon field as an assertive live region and the coupon-success message as polite', async () => {
    stubPageLoad('success', {
      valid: true,
      couponDiscountPercent: 30,
      couponDiscountKind: 'percent',
      couponDiscountValue: 30,
      serviceDiscountPercent: null,
      appliedDiscountPercent: 30,
      originalPrice: 300_000,
      finalPrice: 210_000,
      estimatedDeposit: 200_000,
    })
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()

    // The coupon input sits inside a role="alert" wrapper so an invalid-coupon message is
    // announced without needing to touch the shared BaseInput component.
    expect(wrapper.find('input').element.closest('[role="alert"]')).toBeTruthy()

    await wrapper.find('input').setValue('SAVE30')
    await wrapper.findAll('button').find((b: DOMWrapper<Element>) => b.text() === 'اعمال')!.trigger('click')
    await flushPromises()

    const successEl = wrapper.findAll('[aria-live="polite"]').find((el: DOMWrapper<Element>) => el.text().includes('صرفه‌جویی کردید'))
    expect(successEl).toBeTruthy()
  })
})
