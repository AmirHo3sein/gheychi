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
const SERVICE = { id: 'svc-1', name: 'Haircut', description: null as string | null, price: 300_000, durationMin: 30 }
const TERMS = { depositPercent: 20, depositMinToman: 200_000, cancellationWindowHours: 24 }
const SLOT_ISO = '2026-07-10T09:00:00.000Z'

// Shape matches how ofetch surfaces an HTTP error response: the status hangs off
// `response`, and the API's own JSON body (with its Persian `message` and, since the
// error-code migration, an optional machine-readable `code`) off `data`.
function apiError(status: number, message?: string, code?: string) {
  const data = message || code ? { ...(message ? { message } : {}), ...(code ? { code } : {}) } : undefined
  return { rejectWith: { response: { status }, data } }
}

// Drives the coupon field exactly as a customer would -- type the code, press "اعمال" --
// rather than poking the component's internals, so the assertions below stay about what the
// page tells the customer.
async function applyCouponCode(wrapper: Awaited<ReturnType<typeof mountSuspended>>, code: string) {
  await wrapper.find('input').setValue(code)
  await wrapper.findAll('button').find((b: DOMWrapper<Element>) => b.text() === 'اعمال')!.trigger('click')
  await flushPromises()
}

function stubPageLoad(
  bookingsBehavior: 'success' | { rejectWith: unknown },
  couponValidateResponse?: unknown,
  // Overrides the single service the page resolves, for tests that need a different price
  // (e.g. one below depositMinToman). Defaults to the shared SERVICE fixture.
  service: typeof SERVICE = SERVICE,
  // 0 (the default) matches every pre-wallet-feature test's implicit behavior: the page's
  // own /wallet/mine lookup uses redirectOn401:false + silent:true, so even an unstubbed
  // path here (which the catch-all below throws on) is swallowed by apiFetch into a quiet
  // {data:null} -- same as a logged-out guest, no checkbox rendered.
  walletBalanceToman = 0,
  // [] (the default) matches every pre-worker-picker test's implicit behavior (an
  // unstubbed /workers path also degrades to [] via the same apiFetch-catches-everything
  // path) -- no workers means no picker renders, exactly today's "any available" default.
  workers: Array<{ id: string; name: string; ratingAvg: number; ratingCount: number }> = [],
) {
  fetchMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (path === '/salons/test-salon') return SALON
    if (path === '/salons/test-salon/services') return [service]
    if (path === '/platform-config/booking-terms') return TERMS
    if (path === '/salons/test-salon/workers') return workers
    if (path === `/salons/${SALON.id}/availability`) return []
    if (path === '/wallet/mine') return { balances: [{ currency: 'toman', balance: walletBalanceToman }] }
    if (path === '/coupons/validate' && opts?.method === 'POST') {
      if (couponValidateResponse && typeof couponValidateResponse === 'object' && 'rejectWith' in couponValidateResponse) {
        throw (couponValidateResponse as { rejectWith: unknown }).rejectWith
      }
      return couponValidateResponse
    }
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
    // useState has no $reset() -- shared across every test in this file (see the
    // feature-flags gating test below).
    useState('feature-flags').value = {
      reviewsEnabled: true,
      storiesEnabled: true,
      portfolioEnabled: true,
      referralsEnabled: true,
      couponsEnabled: true,
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hides the coupon field entirely when feature_coupons_enabled is off', async () => {
    stubPageLoad('success')
    useState('feature-flags').value = {
      reviewsEnabled: true,
      storiesEnabled: true,
      portfolioEnabled: true,
      referralsEnabled: true,
      couponsEnabled: false,
    }
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()

    expect(wrapper.text()).not.toContain('کد تخفیف دارید؟')
    expect(wrapper.findAll('button').some((b: DOMWrapper<Element>) => b.text() === 'اعمال')).toBe(false)
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

  it('shows the listed duration, and a provider-authored note when the duration may run longer', async () => {
    stubPageLoad('success', undefined, {
      ...SERVICE,
      description: 'این زمان تقریبی است و ممکن است بیشتر طول بکشد',
    })
    wrapper = await mountSuspended(BookingConfirmPage)

    expect(wrapper.text()).toContain(SERVICE.durationMin.toLocaleString('fa-IR'))
    expect(wrapper.text()).toContain('این زمان تقریبی است و ممکن است بیشتر طول بکشد')
  })

  it('omits the duration note when the provider did not set one', async () => {
    stubPageLoad('success')
    wrapper = await mountSuspended(BookingConfirmPage)

    expect(wrapper.text()).toContain(SERVICE.durationMin.toLocaleString('fa-IR'))
    expect(wrapper.text()).not.toContain('تقریبی')
  })

  // The fixture price (300,000) sits above depositMinToman, so the case above never
  // exercises the cap. calculateDeposit() caps the deposit at the price -- the minimum is a
  // floor on a normal price, not a licence to quote more than the service costs -- and this
  // page duplicates that formula for its pre-submit estimate. Before the cap was mirrored
  // here, a 150,000-toman service was quoted 200,000 while the server charged 150,000.
  it('caps the deposit estimate at the service price for a service cheaper than depositMinToman', async () => {
    stubPageLoad('success', undefined, { ...SERVICE, price: 150_000 })
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()

    expect(wrapper.text()).toContain((150_000).toLocaleString('fa-IR'))
    expect(wrapper.text()).not.toContain((200_000).toLocaleString('fa-IR'))
  })

  it('does not render a wallet checkbox when the customer has no wallet balance', async () => {
    stubPageLoad('success', undefined, SERVICE, 0)
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()

    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('applying the wallet checkbox reduces the online deposit preview and is sent on submit', async () => {
    stubPageLoad('success', undefined, SERVICE, 50_000)
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()

    // deposit before wallet: max(round(300,000*20/100), 200,000) = 200,000 (the cap).
    expect(wrapper.text()).toContain((200_000).toLocaleString('fa-IR'))

    await wrapper.find('input[type="checkbox"]').setValue(true)
    await nextTick()

    // min(50,000 balance, 200,000 deposit) = 50,000 applied -- 150,000 due online.
    expect(wrapper.text()).toContain((150_000).toLocaleString('fa-IR'))

    await wrapper.find('[data-testid="confirm-booking-button"]').trigger('click')
    await flushPromises()

    const bookingCall = fetchMock.mock.calls.find(([path]) => path === '/bookings')
    expect(bookingCall?.[1]).toMatchObject({ body: expect.objectContaining({ applyWalletBalance: true }) })
  })

  it('does not send applyWalletBalance when the wallet checkbox is left unchecked', async () => {
    stubPageLoad('success', undefined, SERVICE, 50_000)
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()
    await wrapper.find('[data-testid="confirm-booking-button"]').trigger('click')
    await flushPromises()

    const bookingCall = fetchMock.mock.calls.find(([path]) => path === '/bookings')
    expect(bookingCall?.[1]).toMatchObject({ body: expect.objectContaining({ applyWalletBalance: undefined }) })
  })

  it('requests the worker roster scoped to this service, so a restricted worker never appears for an ineligible service', async () => {
    stubPageLoad('success', undefined, SERVICE, 0, [{ id: 'w1', name: 'Sara', ratingAvg: 4.5, ratingCount: 10 }])
    wrapper = await mountSuspended(BookingConfirmPage)

    const workersCall = fetchMock.mock.calls.find(([path]) => path === '/salons/test-salon/workers')
    expect(workersCall?.[1]).toMatchObject({ query: { serviceId: 'svc-1' } })
  })

  it('does not render a worker picker when the salon has no workers', async () => {
    stubPageLoad('success', undefined, SERVICE, 0, [])
    wrapper = await mountSuspended(BookingConfirmPage)

    expect(wrapper.text()).not.toContain('هر متخصص در دسترس')
  })

  it('defaults to "any available staff" (no workerId sent) and passes it through to SlotPicker', async () => {
    stubPageLoad('success', undefined, SERVICE, 0, [{ id: 'w1', name: 'Sara', ratingAvg: 4.5, ratingCount: 10 }])
    wrapper = await mountSuspended(BookingConfirmPage)

    expect(wrapper.text()).toContain('هر متخصص در دسترس')
    expect(wrapper.text()).toContain('Sara')
    expect(wrapper.findComponent(SlotPicker).props('workerId')).toBeNull()

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()
    await wrapper.find('[data-testid="confirm-booking-button"]').trigger('click')
    await flushPromises()

    const bookingCall = fetchMock.mock.calls.find(([path]) => path === '/bookings')
    expect(bookingCall?.[1]).toMatchObject({ body: expect.objectContaining({ workerId: undefined }) })
  })

  it('picking a specific worker feeds SlotPicker, clears any already-selected slot, and is sent on submit', async () => {
    stubPageLoad('success', undefined, SERVICE, 0, [{ id: 'w1', name: 'Sara', ratingAvg: 4.5, ratingCount: 10 }])
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()
    expect(wrapper.find('[data-testid="confirm-booking-button"]').exists()).toBe(true)

    await wrapper.findAll('button').find((b: DOMWrapper<Element>) => b.text() === 'Sara')!.trigger('click')
    await nextTick()

    // Switching workers invalidates whatever slot was picked against the old choice.
    expect(wrapper.find('[data-testid="confirm-booking-button"]').exists()).toBe(false)
    expect(wrapper.findComponent(SlotPicker).props('workerId')).toBe('w1')

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()
    await wrapper.find('[data-testid="confirm-booking-button"]').trigger('click')
    await flushPromises()

    const bookingCall = fetchMock.mock.calls.find(([path]) => path === '/bookings')
    expect(bookingCall?.[1]).toMatchObject({ body: expect.objectContaining({ workerId: 'w1' }) })
  })

  // No structured body at all (e.g. a bare 409 with no JSON, or defensively an
  // older/unexpected API response) -- exercises the plain status===409 fallback,
  // same reasoning as mentionsCoupon's own fallback test above.
  it('on a 409 from POST /bookings with no `code`, shows the conflict message and clears the selected slot', async () => {
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

  // The booking-availability counterpart of the coupon `code` migration: POST /bookings now
  // carries BOOKING_UNAVAILABLE/WORKER_UNAVAILABLE on its 409 body (apps/api's
  // booking-error-codes.ts). Both are read via `code` first, not the bare HTTP status.
  it.each([
    ['BOOKING_UNAVAILABLE', 'Slot no longer available'],
    ['WORKER_UNAVAILABLE', 'این کارمند در این زمان نوبت دیگری دارد'],
  ])('on a 409 with code=%s from POST /bookings, shows the conflict message and clears the selected slot', async (code, message) => {
    stubPageLoad(apiError(409, message, code))
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()

    await wrapper.find('[data-testid="confirm-booking-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('این نوبت همین الان رزرو شد')
    expect(wrapper.find('[data-testid="confirm-booking-button"]').exists()).toBe(false)
  })

  // A `code` that isn't one of the booking-conflict codes must not be treated as one just
  // because SOME code is present -- mirrors the equivalent coupon test above.
  it('does not treat a non-booking-conflict `code` on a 409 as a booking conflict', async () => {
    stubPageLoad(apiError(409, 'یک تداخل دیگر', 'SOME_OTHER_CODE'))
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()

    await wrapper.find('[data-testid="confirm-booking-button"]').trigger('click')
    await flushPromises()

    // Falls through to the generic non-coupon-400 handling; a 409 with no matching code
    // and no Persian-detectable customer message (customerFacingMessage only runs for
    // status 400) still lands on the generic fallback copy, not the booking-conflict one.
    expect(wrapper.text()).not.toContain('این نوبت همین الان رزرو شد')
    expect(wrapper.text()).toContain('خطایی رخ داد، لطفا دوباره تلاش کنید')
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
    await applyCouponCode(wrapper, 'SAVE30')

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
    await applyCouponCode(wrapper, 'SAVE50K')

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

  // The saving line credits the COUPON. `finalPrice` from /coupons/validate is the best of
  // BOTH candidates, so "originalPrice - finalPrice > 0" is also true for a coupon that lost
  // to the service's own discount -- which used to print "شما ۹۰,۰۰۰ تومان صرفه‌جویی کردید"
  // for a coupon that saved the customer nothing at all.
  it('does NOT credit a coupon with the service discount\'s saving when the coupon lost', async () => {
    stubPageLoad('success', {
      valid: true,
      // A weak 10% coupon against a service that already discounts 30% -- the service wins,
      // so finalPrice is exactly what the service discount alone would have produced.
      couponDiscountPercent: 10,
      couponDiscountKind: 'percent',
      couponDiscountValue: 10,
      serviceDiscountPercent: 30,
      appliedDiscountPercent: 30,
      originalPrice: 300_000,
      finalPrice: 210_000,
      estimatedDeposit: 200_000,
    })
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()
    await applyCouponCode(wrapper, 'WEAK10')

    expect(wrapper.text()).not.toContain('صرفه‌جویی کردید')
    expect(wrapper.text()).not.toContain((90_000).toLocaleString('fa-IR'))
    // ...and says so plainly instead of the old "applied successfully" next to an unmoved price.
    expect(wrapper.text()).toContain('قیمت تغییری نمی‌کند')
    // The badge still shows the service's real 30% -- that discount is genuinely applied.
    expect(wrapper.text()).toContain('٪' + (30).toLocaleString('fa-IR'))
  })

  // A tie is not a win: resolveBestPriceWithWinner() keeps the earlier candidate (the
  // service) on an equal resulting price, so an equally-good coupon changes nothing.
  it('treats a coupon that merely ties the service discount as not having won', async () => {
    stubPageLoad('success', {
      valid: true,
      couponDiscountPercent: 30,
      couponDiscountKind: 'percent',
      couponDiscountValue: 30,
      serviceDiscountPercent: 30,
      appliedDiscountPercent: 30,
      originalPrice: 300_000,
      finalPrice: 210_000,
      estimatedDeposit: 200_000,
    })
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()
    await applyCouponCode(wrapper, 'TIE30')

    expect(wrapper.text()).not.toContain('صرفه‌جویی کردید')
    expect(wrapper.text()).toContain('قیمت تغییری نمی‌کند')
  })

  // Every coupon rejection used to collapse into "کد تخفیف نامعتبر است", telling a customer
  // whose code was expired (or already used, or capped out) to re-check a code they typed
  // perfectly. The API's 400 body already says which it is, in Persian.
  it('surfaces the API\'s own reason when POST /coupons/validate rejects the code', async () => {
    stubPageLoad('success', apiError(400, 'کد تخفیف منقضی شده است'))
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()
    await applyCouponCode(wrapper, 'EXPIRED')

    expect(wrapper.text()).toContain('کد تخفیف منقضی شده است')
    expect(wrapper.text()).not.toContain('کد تخفیف نامعتبر است')
  })

  // A 500/network failure on the preview says nothing about the code itself, so it must not
  // be dressed up as a verdict on it.
  it('falls back to generic copy when the coupon check fails for a non-400 reason', async () => {
    stubPageLoad('success', apiError(500))
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()
    await applyCouponCode(wrapper, 'ANYCODE')

    expect(wrapper.text()).toContain('بررسی کد تخفیف ممکن نشد')
  })

  // createHold re-validates the coupon inside its own transaction, so a code that passed the
  // preview can still be refused at submit time. That used to surface as "an error occurred,
  // try again" AND wipe the selected slot -- leaving the dead coupon applied, so re-picking a
  // slot failed identically forever with no hint that the code was the blocker. This response
  // carries no `code` (as an older/uncoded API response would), so it exercises the
  // message-substring fallback specifically.
  it('drops the coupon, keeps the slot, and explains the retry when POST /bookings rejects the code (no `code`, fallback path)', async () => {
    stubPageLoad(apiError(400, 'ظرفیت استفاده از این کد تخفیف تکمیل شده است'), {
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
    await applyCouponCode(wrapper, 'CAPPED')
    expect(wrapper.text()).toContain('صرفه‌جویی کردید')

    await wrapper.find('[data-testid="confirm-booking-button"]').trigger('click')
    await flushPromises()

    // The real reason, not "خطایی رخ داد".
    expect(wrapper.text()).toContain('ظرفیت استفاده از این کد تخفیف تکمیل شده است')
    expect(wrapper.text()).not.toContain('خطایی رخ داد')
    // Says the code is gone and the booking can go through without it.
    expect(wrapper.text()).toContain('می‌توانید بدون آن پرداخت را ادامه دهید')
    // The coupon is actually dropped (its saving line is gone), so the retry sends no code...
    expect(wrapper.text()).not.toContain('صرفه‌جویی کردید')
    // ...and the slot -- which was never the problem -- survives, so that retry is one tap away.
    expect(wrapper.find('[data-testid="confirm-booking-button"]').exists()).toBe(true)
  })

  // The whole point of the error-code migration: a coupon rejection is now identified by
  // `code`, not by string-matching the Persian message -- so this passes even with wording
  // that shares no substring with "کد تخفیف" at all, which the old mentionsCoupon() would
  // have missed entirely.
  it('drops the coupon via its `code`, keeps the slot, even when the message is reworded away from "کد تخفیف"', async () => {
    stubPageLoad(apiError(400, 'این کد دیگر در دسترس نیست', 'COUPON_LIMIT_REACHED'), {
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
    await applyCouponCode(wrapper, 'CAPPED')

    await wrapper.find('[data-testid="confirm-booking-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('این کد دیگر در دسترس نیست')
    expect(wrapper.text()).toContain('می‌توانید بدون آن پرداخت را ادامه دهید')
    expect(wrapper.text()).not.toContain('صرفه‌جویی کردید')
    expect(wrapper.find('[data-testid="confirm-booking-button"]').exists()).toBe(true)
  })

  // A `code` that isn't one of the four coupon codes (e.g. a startsAt validation error that
  // happened to also carry a code from some other future feature) must not be treated as a
  // coupon failure just because a code is present at all.
  it('does not treat a non-coupon `code` as a coupon failure', async () => {
    stubPageLoad(apiError(400, 'رزرو دیگر امکان‌پذیر نیست', 'SOME_OTHER_CODE'), {
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
    await applyCouponCode(wrapper, 'SAVE30')

    await wrapper.find('[data-testid="confirm-booking-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('رزرو دیگر امکان‌پذیر نیست')
    // Treated as a generic (slot-invalidating) failure, not the coupon-dropped path.
    expect(wrapper.text()).not.toContain('می‌توانید بدون آن پرداخت را ادامه دهید')
    expect(wrapper.find('[data-testid="confirm-booking-button"]').exists()).toBe(false)
  })

  // The counterpart: a 400 with no coupon involved (createHold's only other one is a
  // past/invalid startsAt) does invalidate the slot, and its message is a developer-facing
  // English string that must never be shown to a customer.
  it('clears the slot and never shows a non-Persian API message on a non-coupon 400', async () => {
    stubPageLoad(apiError(400, 'startsAt must be a valid future date-time'))
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()
    await wrapper.find('[data-testid="confirm-booking-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('startsAt')
    expect(wrapper.text()).toContain('خطایی رخ داد، لطفا دوباره تلاش کنید')
    expect(wrapper.find('[data-testid="confirm-booking-button"]').exists()).toBe(false)
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

  // Layout regression guard for the money path at 320px (PRODUCT.md's hard floor: budget
  // Android). A flex item's automatic minimum size is its min-content width, and an
  // <input>'s min-content width is its intrinsic `size` default (~180px in Chrome), NOT the
  // `w-full` it is styled with -- percentages resolve to auto during intrinsic sizing. So
  // without min-w-0 the coupon field refuses to shrink below ~210px, which together with
  // the "اعمال" button overflows the card's ~254px content box and scrolls the page body
  // sideways (leftward, in RTL). happy-dom has no layout engine, so the two classes that
  // carry the fix are pinned directly.
  it('lets the coupon field shrink and keeps the apply button whole (no sideways scroll at 320px)', async () => {
    stubPageLoad('success')
    wrapper = await mountSuspended(BookingConfirmPage)

    await wrapper.findComponent(SlotPicker).vm.$emit('select', SLOT_ISO)
    await nextTick()

    const fieldWrapper = wrapper.find('input').element.closest('[role="alert"]')!
    expect(fieldWrapper.classList.contains('min-w-0')).toBe(true)

    const applyButton = wrapper.findAll('button').find((b: DOMWrapper<Element>) => b.text() === 'اعمال')!
    expect(applyButton.classes()).toContain('shrink-0')
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

    await applyCouponCode(wrapper, 'SAVE30')

    const successEl = wrapper.findAll('[aria-live="polite"]').find((el: DOMWrapper<Element>) => el.text().includes('صرفه‌جویی کردید'))
    expect(successEl).toBeTruthy()
  })
})
