<script setup lang="ts">
import type { ApiError } from '~/composables/useApi'
import { applyDiscount } from '../../../utils/discount'
import { formatToman } from '../../../utils/format-toman'
import { isUuid } from '../../../utils/beauty-guide'
import { formatAppointment, formatDateTime } from '../../../utils/format-date'
import { workerDisplayLabels } from '../../../utils/worker-label'

// `bookingConfirmationMode` is on the public GET /salons/:slug payload (findPublicBySlug
// returns the whole salon row), which is what lets this page tell the customer BEFORE they
// commit that this salon reviews requests by hand. The booking's own mode is still frozen
// server-side at creation time -- this field is only ever used for pre-submit copy, never
// to decide what the page does with the response (that's `paymentRequired`, below).
interface Salon { id: string; name: string; address: string; bookingConfirmationMode: 'automatic' | 'manual_approval' }
// imageUrl: the service's optional primary photo -- optional in the type so an older API
// without the field simply renders no thumbnail.
// pricingType: optional so an older payload (and the fixed-only fixtures) read as 'fixed'.
interface SalonServiceItem { id: string; name: string; description: string | null; price: number; durationMin: number; discountPercent: number | null; imageUrl?: string | null; pricingType?: 'fixed' | 'from' | 'range' | 'quote'; priceMax?: number | null }
interface BookingTerms { depositPercent: number; depositMinToman: number; cancellationWindowHours: number }
// GET /salons/:slug/workers (PublicSalonContentController) -- active workers only,
// the same minimal projection the public worker-ratings page already relies on.
interface SalonWorker { id: string; name: string; ratingAvg: number; ratingCount: number }

/**
 * Authoritative shape of POST /coupons/validate's 201 response (Slice 6:
 * apps/api/src/coupons/coupon-validation.controller.ts). A coupon can now be either
 * percent- or fixed-toman-kind, so `couponDiscountPercent`/`appliedDiscountPercent`
 * are only ever populated when the relevant discount is actually percent-based --
 * never fabricated as a percent equivalent of a fixed-toman amount.
 */
interface CouponValidationResult {
  valid: true
  couponDiscountPercent: number | null
  couponDiscountKind: 'percent' | 'fixed'
  couponDiscountValue: number
  serviceDiscountPercent: number | null
  appliedDiscountPercent: number | undefined
  originalPrice: number
  finalPrice: number
  estimatedDeposit: number
}

const route = useRoute()
// Carried over as a query param from the salon profile page's own "Book" link (see
// utils/attribution.ts) -- only the platform's own fixed value set is trusted, since the
// query string is otherwise customer/attacker-controlled; anything else is silently dropped
// rather than forwarded to the API, which would reject it anyway (CreateBookingDto.attributionSource).
const ATTRIBUTION_SOURCES = new Set(['qr', 'direct', 'search'])
const attributionSource = ATTRIBUTION_SOURCES.has(String(route.query.source))
  ? (route.query.source as string)
  : undefined
// The customer's own Beauty Guide, when the booking started from one. Only a well-formed
// UUID is forwarded; the API additionally rejects a guide that isn't this user's.
const beautyGuideId = isUuid(route.query.beautyGuideId) ? route.query.beautyGuideId : undefined
const slug = route.params.slug as string
const serviceId = route.params.serviceId as string
const { apiFetch } = useApi()
const { flags: featureFlags } = useFeatureFlags()

const { data: page } = await useAsyncData(`booking-${slug}-${serviceId}`, async () => {
  const [salonRes, servicesRes, termsRes, workersRes] = await Promise.all([
    apiFetch<Salon>(`/salons/${slug}`, { silent: true }),
    apiFetch<SalonServiceItem[]>(`/salons/${slug}/services`, { silent: true }),
    apiFetch<BookingTerms>('/platform-config/booking-terms', { silent: true }),
    // serviceId narrows the roster to workers actually eligible for THIS service (an
    // owner can restrict a worker to a subset of the salon's services) -- see
    // PublicSalonContentController.listWorkers on the API side.
    apiFetch<SalonWorker[]>(`/salons/${slug}/workers`, { query: { serviceId }, silent: true }),
  ])
  const service = servicesRes.data?.find((s) => s.id === serviceId)
  if (!salonRes.data || !service) return null
  return { salon: salonRes.data, service, terms: termsRes.data, workers: workersRes.data ?? [] }
})

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Service not found' })
}

// Drives every piece of pre-submit copy on this page that would otherwise promise an
// immediate booking. Compared against the explicit 'manual_approval' value (not `!==
// 'automatic'`) so an older API response without the field at all falls back to the
// unchanged, pay-now wording rather than silently telling everyone they're only requesting.
const manualApproval = computed(() => page.value?.salon.bookingConfirmationMode === 'manual_approval')

// Only a FIXED-price service can be booked online (BookingsService.createHoldImpl rejects any
// other pricing type), and the salon page already blocks the click into this page for them --
// this is the backstop for a typed/old URL, so a FROM/RANGE/QUOTE service is never shown with
// a fabricated exact price and a submit button that can only 400.
const bookableOnline = computed(() => !page.value?.service.pricingType || page.value.service.pricingType === 'fixed')

// null = "any available staff", exactly today's unchanged default.
const selectedWorkerId = ref<string | null>(null)
// Owner-typed placeholder names («عضو ۱») read as «متخصص سالن» -- see utils/worker-label.ts.
const workerLabels = computed(() => workerDisplayLabels(page.value?.workers ?? []))
const selectedWorkerLabel = computed(() => (selectedWorkerId.value ? workerLabels.value[selectedWorkerId.value] : 'هر متخصص در دسترس'))

// The visible step structure: خدمت → متخصص (only when the salon lists staff) → زمان → بررسی.
const steps = computed(() => [
  { key: 'service', label: 'خدمت' },
  ...(page.value?.workers.length ? [{ key: 'staff', label: 'متخصص' }] : []),
  { key: 'time', label: 'زمان' },
  { key: 'review', label: 'تایید' },
])
function stepNumber(key: string): string {
  return (steps.value.findIndex((s) => s.key === key) + 1).toLocaleString('fa-IR')
}
const currentStep = computed(() => (selectedSlot.value ? 'review' : 'time'))
function stepState(key: string): 'done' | 'current' | 'todo' {
  const order = steps.value.map((s) => s.key)
  const at = order.indexOf(currentStep.value)
  const i = order.indexOf(key)
  return i < at ? 'done' : i === at ? 'current' : 'todo'
}

const submitLabel = computed(() =>
  manualApproval.value ? 'ثبت درخواست رزرو' : (featureFlags.value.onlinePaymentEnabled ? 'پرداخت و رزرو' : 'رزرو'),
)

// This route isn't in isPublicRoute()'s list, so auth.global.ts already redirected any
// anonymous visitor to /login before this script ever runs -- the customer is guaranteed
// logged in here. redirectOn401: false is still correct, just for a narrower reason: a
// session that expires between page load and this fetch (or a stale cookie) should not
// force-redirect mid-view over a lookup the customer never triggered themselves -- the
// wallet section just quietly shows nothing, same as a genuine zero balance. silent: true
// for the same reason: no toast for a background lookup.
const { data: walletBalanceToman } = await useAsyncData(`booking-wallet-${slug}-${serviceId}`, async () => {
  const { data } = await apiFetch<{ balances: Array<{ currency: string; balance: number }> }>('/wallet/mine', {
    silent: true,
    redirectOn401: false,
  })
  return data?.balances.find((b) => b.currency === 'toman')?.balance ?? 0
})

const applyWalletBalance = ref(false)

const selectedSlot = ref<string | null>(null)
const submitting = ref(false)
const submitError = ref('')

// Choosing a specific worker re-filters SlotPicker's own availability fetch to that
// worker's real schedule (see its workerId prop) -- a slot picked before switching
// workers may no longer be valid for the new one, so the selection is cleared on
// change rather than silently carried over to a worker it was never checked against.
watch(selectedWorkerId, () => {
  selectedSlot.value = null
})

// The confirm card mounts below the fold on a phone once a time is picked; bring it into
// view (instantly, if the customer asked for reduced motion) so the next step is obvious.
// Only when the card APPEARS -- switching between two slots must not re-scroll the page.
const confirmCardEl = ref<HTMLElement | null>(null)
watch(selectedSlot, async (slot, previous) => {
  if (!slot || previous) return
  await nextTick()
  const el = confirmCardEl.value
  if (!el || typeof el.scrollIntoView !== 'function') return
  const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' })
})

// Phones: a bottom bar with the chosen time, the price and the submit action appears once a
// slot is picked -- and steps aside while the confirm card's own button is on screen, so the
// same action is never shown twice in one view.
const confirmButtonEl = ref<HTMLElement | null>(null)
const confirmButtonInView = ref(false)
let confirmObserver: IntersectionObserver | undefined
watch(confirmButtonEl, (el) => {
  confirmObserver?.disconnect()
  confirmButtonInView.value = false
  if (!el || typeof IntersectionObserver === 'undefined') return
  confirmObserver = new IntersectionObserver(([entry]) => {
    confirmButtonInView.value = !!entry?.isIntersecting
  })
  // Same vue-tsc template-ref inference quirk as useDialog.ts: el really is an Element.
  confirmObserver.observe(el as unknown as Element)
})
onBeforeUnmount(() => confirmObserver?.disconnect())
const showStickyBar = computed(() => !!selectedSlot.value && !confirmButtonInView.value)

const couponCode = ref('')
const couponApplying = ref(false)
const couponError = ref('')
// Holds the last successfully-validated coupon plus the exact code string that produced
// it -- the code is what confirmBooking() sends, not whatever couponCode currently holds,
// since those two can diverge the instant a stale appliedCoupon is cleared below.
const appliedCoupon = ref<(CouponValidationResult & { code: string }) | null>(null)

// A coupon result is only valid for the exact code that produced it -- once the field is
// edited, the previously-applied discount can no longer be trusted, so both must clear.
watch(couponCode, () => {
  if (appliedCoupon.value) appliedCoupon.value = null
  if (couponError.value) couponError.value = ''
})

// The discount percent badge is ONLY shown once a coupon is applied when the winning
// discount (service vs. coupon, whichever resulted in the lower price -- see
// resolveBestPriceWithWinner() in apps/api/src/booking/discount.util.ts) was itself
// percent-based. A fixed-toman coupon winning must never be displayed as a fabricated
// percent -- `appliedDiscountPercent` is `undefined` from the server in exactly that
// case, so this stays `null` and the badge simply doesn't render (the savings-amount
// line below still shows, since it works for any discount kind).
const activeDiscountPercent = computed(() => {
  if (appliedCoupon.value) return appliedCoupon.value.appliedDiscountPercent ?? null
  return page.value?.service.discountPercent ?? null
})

const displayPrice = computed(() => {
  if (appliedCoupon.value) return appliedCoupon.value.finalPrice
  if (!page.value) return 0
  return applyDiscount(page.value.service.price, page.value.service.discountPercent)
})

// Did the applied coupon actually WIN against the service's own discount? /coupons/validate
// exposes no winner/applied flag of its own (unlike POST /bookings, which returns
// `couponApplied`), so it has to be derived: `finalPrice` is the best of BOTH candidates, so
// the coupon only won if that price beats what the service's own discount alone would have
// produced. A tie is deliberately NOT a win -- resolveBestPriceWithWinner() keeps the
// earlier candidate (the service) on an equal resulting price, so an equally-good coupon
// changes nothing about what's charged. `finalPrice` itself always comes from the server;
// only the service-alone comparison price is computed here, with applyDiscount() mirroring
// the server's percent rounding exactly (see app/utils/discount.ts).
const couponWon = computed(() => {
  const coupon = appliedCoupon.value
  if (!coupon) return false
  return coupon.finalPrice < applyDiscount(coupon.originalPrice, coupon.serviceDiscountPercent)
})

// "You saved X toman" -- always correct regardless of discount kind (percent or
// fixed), since it's derived from the two authoritative prices rather than from any
// percent figure. Gated on couponWon: this line credits the COUPON with the saving, so a
// service-only discount that the coupon merely failed to beat must never be reported here
// (it used to be -- any positive originalPrice - finalPrice counted, so a weak coupon on a
// 30%-off service claimed the service's own 90,000 toman as the coupon's work). A genuine
// win always implies a positive saving (finalPrice < the service-alone price <=
// originalPrice), so no second sign check is needed.
const couponSavings = computed(() => {
  if (!couponWon.value || !appliedCoupon.value) return null
  return appliedCoupon.value.originalPrice - appliedCoupon.value.finalPrice
})

// Mirrors calculateDeposit() in apps/api/src/booking/deposit.util.ts -- this is a
// display-only pre-submit estimate; the backend recomputes the real deposit from its own
// platform-config values (and, if a coupon code is submitted, its own discount
// resolution) at submission time and is the sole source of truth, so a mismatch here is a
// UX/trust issue, not a financial one. Keep in sync with that file. Once a coupon has been
// applied, the server-provided estimatedDeposit from /coupons/validate is authoritative
// and used directly instead of this client-side duplication.
const estimatedDeposit = computed(() => {
  if (!page.value?.terms) return null
  if (appliedCoupon.value) return appliedCoupon.value.estimatedDeposit
  const discountedPrice = applyDiscount(page.value.service.price, page.value.service.discountPercent)
  const pct = Math.round((discountedPrice * page.value.terms.depositPercent) / 100)
  // The discounted price is a hard ceiling, exactly as in calculateDeposit(): the minimum is
  // a floor on a normal price, never a licence to quote more than the service costs. Without
  // this Math.min, any service cheaper than depositMinToman was quoted a deposit ABOVE its
  // own price here while the server (correctly capped) charged less -- an over-quote on the
  // one number the customer is deciding on.
  return Math.max(0, Math.min(Math.max(pct, page.value.terms.depositMinToman), discountedPrice))
})

// Display-only preview of what createHold's own wallet debit will actually apply
// (min(balance, deposit)) -- the server is still the sole source of truth (same
// caveat as estimatedDeposit above), this only keeps the checkbox from promising an
// amount larger than either the deposit or the customer's real balance.
const walletAmountToApply = computed(() => {
  if (!applyWalletBalance.value || estimatedDeposit.value === null) return 0
  return Math.min(walletBalanceToman.value ?? 0, estimatedDeposit.value)
})

const depositDueOnline = computed(() => {
  if (estimatedDeposit.value === null) return null
  return estimatedDeposit.value - walletAmountToApply.value
})

// The API's 4xx bodies are the only explanation of WHY a coupon or a hold was refused, and
// every one a customer can act on is already written for them in Persian (CouponsService's
// four distinct rejections: unknown code, expired, already redeemed by this user, redemption
// cap full). But not every message on those paths is customer copy -- createHold's
// `startsAt must be a valid future date-time` and the salon/service 404s are developer-facing
// English -- so a message with no Persian in it is treated as unusable and falls back to
// generic copy rather than being shown verbatim.
const PERSIAN_TEXT = /[\u0600-\u06FF]/
function customerFacingMessage(message: string | undefined): string | null {
  return message && PERSIAN_TEXT.test(message) ? message : null
}

// `error.serverMessage` (not `.message`) is deliberate: `.message` is always some Persian
// sentence now (useApi substitutes a status-based fallback for English), but this page needs
// to know whether the API itself gave a real, actionable reason.

// A coupon rejection from POST /bookings now carries a stable, machine-readable `code`
// (see apps/api's coupon-error-codes.ts) whenever the API returned a real, structured
// JSON body -- CouponsService.resolveAndValidate's four rejections and createHold's own
// duplicate-redemption race backstop all set one. Checking `code` against that fixed set
// is the primary signal here, immune to any future rewording of the Persian message.
// The substring check on the message is kept ONLY as a fallback for a response with no
// structured body at all (e.g. a network-level failure, or -- defensively -- an older/
// unexpected API response that never carried a code), not as the primary signal anymore.
const COUPON_ERROR_CODES = new Set([
  'COUPON_INVALID',
  'COUPON_EXPIRED',
  'COUPON_ALREADY_REDEEMED',
  'COUPON_LIMIT_REACHED',
])
function mentionsCoupon(error: ApiError | null, message: string): boolean {
  if (error?.code) return COUPON_ERROR_CODES.has(error.code)
  return message.includes('کد تخفیف')
}

// A booking-conflict rejection from POST /bookings also now carries a stable `code`
// (see apps/api's booking-error-codes.ts): BOOKING_UNAVAILABLE for the salon-capacity/
// slot-overlap and lock-contention conflicts, WORKER_UNAVAILABLE for the narrower case
// where the chosen worker specifically is double-booked. Both currently get the exact
// same generic "this slot was just taken" copy below, but checking `code` first (rather
// than the bare HTTP status) is what lets that copy diverge later without silently
// falling out of sync with whichever conflicts the API actually distinguishes. The
// plain `status === 409` check is kept ONLY as a fallback for a response with no
// structured body at all, same reasoning as mentionsCoupon above.
const BOOKING_CONFLICT_CODES = new Set(['BOOKING_UNAVAILABLE', 'WORKER_UNAVAILABLE'])
function isBookingConflict(error: ApiError | null): boolean {
  if (error?.code) return BOOKING_CONFLICT_CODES.has(error.code)
  return error?.status === 409
}

async function applyCoupon() {
  const code = couponCode.value.trim()
  if (!code || !page.value) return
  couponApplying.value = true
  couponError.value = ''
  const { data, error } = await apiFetch<CouponValidationResult>('/coupons/validate', {
    method: 'POST',
    body: { code, salonId: page.value.salon.id, serviceId },
    silent: true,
  })
  couponApplying.value = false
  if (error || !data) {
    appliedCoupon.value = null
    // Same reasoning as confirmBooking's 401 branch: useApi has already started the
    // redirect to /login, and "invalid code" would be an outright lie about a session
    // that simply expired.
    if (error?.status === 401) return
    // The four coupon rejections are distinct and actionable -- an expired code, a code
    // this user already used, and a code whose redemption cap is full all told the customer
    // "کد تخفیف نامعتبر است" before this, sending them off to re-check a code they typed
    // perfectly. A non-400 carries no coupon-specific meaning, so it keeps generic copy.
    couponError.value =
      (error?.status === 400 ? customerFacingMessage(error.serverMessage) : null) ??
      'بررسی کد تخفیف ممکن نشد، لطفا دوباره تلاش کنید'
    return
  }
  appliedCoupon.value = { ...data, code }
}

async function confirmBooking() {
  if (!selectedSlot.value) return
  submitting.value = true
  submitError.value = ''
  const { data, error } = await apiFetch<{ booking: { id: string }; paymentUrl: string; paymentRequired?: boolean }>('/bookings', {
    method: 'POST',
    body: {
      salonId: page.value!.salon.id,
      serviceId,
      startsAt: selectedSlot.value,
      couponCode: appliedCoupon.value ? appliedCoupon.value.code : undefined,
      applyWalletBalance: applyWalletBalance.value || undefined,
      workerId: selectedWorkerId.value || undefined,
      attributionSource,
      beautyGuideId,
    },
    silent: true,
  })
  submitting.value = false
  if (error || !data) {
    // A 401 here means the session expired mid-booking -- useApi's global handler has
    // already kicked off a redirect to /login, so there's nothing left to show; setting
    // a local error message would just flash "an error occurred" right as the user is
    // being navigated away.
    if (error?.status === 401) return
    if (isBookingConflict(error)) {
      submitError.value = 'این نوبت همین الان رزرو شد، لطفا زمان دیگری را انتخاب کنید'
      selectedSlot.value = null
      return
    }

    const reason = error?.status === 400 ? customerFacingMessage(error.serverMessage) : null

    // createHold re-validates the coupon inside its own transaction, so a code that passed
    // the preview minutes ago can still be refused here (expired in between, redemption cap
    // filled by someone else). That refusal used to become "an error occurred, try again"
    // AND cleared the slot -- so the customer re-picked a slot, failed identically, and had
    // no way to learn that the coupon was the blocker. The dead code is dropped instead and
    // the slot is deliberately KEPT: the slot was never the problem, and the retry now
    // succeeds without the code.
    if (appliedCoupon.value && reason && mentionsCoupon(error, reason)) {
      appliedCoupon.value = null
      couponError.value = reason
      submitError.value = 'کد تخفیف از این نوبت برداشته شد؛ می‌توانید بدون آن پرداخت را ادامه دهید'
      return
    }

    // Anything else (a stale/past slot, a server error) genuinely invalidates the chosen
    // slot, so clearing it and making the customer re-pick is the right recovery.
    submitError.value = reason ?? 'خطایی رخ داد، لطفا دوباره تلاش کنید'
    selectedSlot.value = null
    return
  }
  // `paymentRequired === false` means the API opened no gateway session at all -- either a
  // manual-approval request awaiting the salon, or a fully-discounted booking with nothing to
  // charge. In both cases `paymentUrl` is this very app's own /bookings/:id (built from the
  // API's FRONTEND_BASE_URL), so navigating to it externally would be a full page reload out
  // to an absolute URL just to land back inside the app. Routed internally instead, and by
  // booking id rather than by parsing the absolute URL: the id is already in hand and can't
  // be thrown off by a FRONTEND_BASE_URL that doesn't match the origin we're actually served
  // from. Checked with `=== false` so an API response without the field keeps the old,
  // unconditional external behaviour.
  // `?created=1` lets the booking page greet this one arrival with its success state, once
  // (it drops the flag from the URL right away, so a refresh or a later visit doesn't).
  if (data.paymentRequired === false) {
    await navigateTo(`/bookings/${data.booking.id}?created=1`)
    return
  }
  await navigateTo(data.paymentUrl, { external: true })
}
</script>

<template>
  <!-- Top-level guard, not just the `page!` assertions below: when the createError(404) throw
       above rejects this component's async setup, Vue's Suspense still runs one render pass of
       this template with `page` at its pre-fetch value (undefined) before the rejection is
       handled. Without this v-if, that pass throws inside the render function itself (an
       unhandled rejection, not the createError) -- see blog/[slug].vue, which this mirrors. -->
  <div v-if="page" class="mx-auto max-w-2xl p-4 lg:max-w-5xl lg:p-6" :class="selectedSlot ? 'pb-28 lg:pb-6' : ''">
    <div class="flex items-center gap-2">
      <NuxtLink
        :to="`/salons/${slug}`"
        aria-label="بازگشت به سالن"
        class="-ms-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle)"
      >
        <BaseIcon name="chevron-forward" :size="20" />
      </NuxtLink>
      <div class="min-w-0">
        <h1 class="truncate text-lg font-bold text-(--color-text)">{{ page.service.name }}</h1>
        <p class="truncate text-xs text-(--color-text-muted)">{{ page.salon.name }} — {{ page.salon.address }}</p>
      </div>
    </div>

    <!-- Where the customer is in the flow. Purely a map of this one page (every step is on
         screen); "done" steps get a check, the step needing attention is highlighted. -->
    <ol v-if="bookableOnline" aria-label="مراحل رزرو" data-testid="booking-steps" class="mt-3 flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs">
      <li v-for="(step, i) in steps" :key="step.key" class="flex shrink-0 items-center gap-1.5">
        <span
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold"
          :class="{
            'bg-(--color-accent-soft) text-(--color-text)': stepState(step.key) === 'current',
            'text-(--color-success-text)': stepState(step.key) === 'done',
            'text-(--color-text-muted)': stepState(step.key) === 'todo',
          }"
          :aria-current="stepState(step.key) === 'current' ? 'step' : undefined"
        >
          <BaseIcon v-if="stepState(step.key) === 'done'" name="check" :size="13" />
          <span v-else class="tnum">{{ (i + 1).toLocaleString('fa-IR') }}</span>
          <!-- Narrow phones: only the current step keeps its label visible, so all steps fit. -->
          <span :class="stepState(step.key) === 'current' ? '' : 'max-[399px]:sr-only'">{{ step.label }}</span>
        </span>
        <BaseIcon v-if="i < steps.length - 1" name="chevron-back" :size="12" class="text-(--color-text-muted)" />
      </li>
    </ol>

    <!-- A salon that reviews requests by hand: say so BEFORE the customer picks anything, in
         plain words, because what they submit here is a request -- not a confirmed booking and
         not a payment. The deadline concept is explained without a number: the timeout is
         admin configuration the public API deliberately doesn't expose, and the booking page
         shows the real countdown the moment the request exists. -->
    <div
      v-if="manualApproval && bookableOnline"
      data-testid="manual-approval-explainer"
      class="mt-4 space-y-1.5 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-4 text-sm"
    >
      <p class="flex items-center gap-1.5 font-bold text-(--color-text)">
        <BaseIcon name="clock" :size="16" class="text-(--color-accent-text)" />
        رزرو در این سالن با تایید سالن قطعی می‌شود
      </p>
      <p class="leading-6 text-(--color-text-muted)">
        با ثبت، یک «درخواست رزرو» برای سالن فرستاده می‌شود و تا وقتی سالن آن را تایید نکند، نوبت قطعی نیست.
        سالن فقط مهلت کوتاهی برای پاسخ دارد؛ اگر در این مهلت پاسخ ندهد، درخواست خودبه‌خود منتفی می‌شود.
        مهلت دقیق را پس از ثبت، در صفحه‌ی همان نوبت می‌بینید.
      </p>
      <p class="leading-6 text-(--color-text-muted)">
        {{ featureFlags.onlinePaymentEnabled
          ? 'اکنون مبلغی پرداخت نمی‌کنید؛ پس از تایید سالن، برای پرداخت بیعانه مهلت محدودی خواهید داشت.'
          : 'در هیچ مرحله‌ای پرداخت آنلاین لازم نیست؛ هزینه در سالن دریافت می‌شود.' }}
      </p>
    </div>

    <div class="mt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
      <div class="min-w-0 space-y-6">
        <!-- Step: the service. A modest thumbnail, never a hero: on a phone the slot picker
             is the page's real job and must stay near the top. Fixed box + explicit
             width/height, so a lazy photo never shifts the header. -->
        <section aria-labelledby="step-service">
          <h2 id="step-service" class="mb-2 flex items-center gap-2 text-sm font-bold text-(--color-text)">
            <span class="step-num">{{ stepNumber('service') }}</span>
            خدمت
          </h2>
          <div class="flex items-start gap-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 shadow-(--shadow-sm)">
            <div
              v-if="page.service.imageUrl"
              data-testid="booking-service-thumb"
              class="size-14 shrink-0 overflow-hidden rounded-xl bg-(--color-surface-subtle)"
            >
              <SafeImage
                :src="page.service.imageUrl"
                :alt="page.service.name"
                :width="112"
                :height="112"
                :placeholder-icon-size="18"
                class="h-full w-full object-cover"
              />
            </div>
            <div class="min-w-0 flex-1 space-y-1 text-sm">
              <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span class="min-w-0 break-words font-bold text-(--color-text)">{{ page.service.name }}</span>
                <ServicePriceTag v-if="!bookableOnline" :service="{ ...page.service, pricingType: page.service.pricingType!, priceMax: page.service.priceMax ?? null }" />
                <span v-else class="font-bold whitespace-nowrap text-(--color-text)"><span dir="ltr" class="tnum">{{ formatToman(displayPrice) }}</span> تومان</span>
              </div>
              <p class="flex items-start gap-1.5 text-xs text-(--color-text-muted)">
                <BaseIcon name="clock" :size="14" class="mt-0.5 shrink-0" />
                <span>
                  مدت زمان: {{ page.service.durationMin.toLocaleString('fa-IR') }} دقیقه
                  <!-- Provider-authored note on the listed duration (e.g. "may take longer") -- the
                       figure above is a minimum, not a guarantee. -->
                  <template v-if="page.service.description"> — {{ page.service.description }}</template>
                </span>
              </p>
            </div>
          </div>
        </section>

        <BaseCard v-if="!bookableOnline" data-testid="booking-not-online" class="space-y-3 text-sm">
          <p class="text-(--color-text)">قیمت این خدمت ثابت نیست، به همین دلیل رزرو آنلاین آن ممکن نیست. برای هماهنگی با سالن تماس بگیرید.</p>
          <NuxtLink :to="`/salons/${slug}`" class="inline-flex min-h-11 items-center font-semibold text-(--color-accent-text) hover:underline">
            بازگشت به صفحه سالن
          </NuxtLink>
        </BaseCard>

        <template v-else>
          <!-- Step: who. Optional -- omitted (selectedWorkerId stays null) means "any available
               staff". Placed before the time because the choice narrows which slots are even
               offered. Selected = soft peach tint + accent outline; the solid peach fill stays
               reserved for the final submit button, so choosing never competes with it. -->
          <section v-if="page.workers.length" aria-labelledby="step-staff">
            <h2 id="step-staff" class="mb-2 flex items-center gap-2 text-sm font-bold text-(--color-text)">
              <span class="step-num">{{ stepNumber('staff') }}</span>
              چه کسی؟
            </h2>
            <div class="flex gap-2 overflow-x-auto pb-0.5">
              <button
                type="button"
                :aria-pressed="selectedWorkerId === null"
                class="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors"
                :class="selectedWorkerId === null
                  ? 'border-(--color-accent-text) bg-(--color-accent-soft) font-bold text-(--color-text) ring-1 ring-(--color-accent-text)'
                  : 'border-(--color-border) bg-(--color-surface-card) text-(--color-text) hover:bg-(--color-surface-subtle)'"
                @click="selectedWorkerId = null"
              >
                هر متخصص در دسترس
              </button>
              <button
                v-for="worker in page.workers"
                :key="worker.id"
                type="button"
                :aria-pressed="selectedWorkerId === worker.id"
                class="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors"
                :class="selectedWorkerId === worker.id
                  ? 'border-(--color-accent-text) bg-(--color-accent-soft) font-bold text-(--color-text) ring-1 ring-(--color-accent-text)'
                  : 'border-(--color-border) bg-(--color-surface-card) text-(--color-text) hover:bg-(--color-surface-subtle)'"
                @click="selectedWorkerId = worker.id"
              >
                {{ workerLabels[worker.id] }}
              </button>
            </div>
          </section>

          <!-- Step: when. selected-slot feeds SlotPicker's own selectedSlot prop so it can render
               which slot is actually selected rather than only emitting 'select'. -->
          <section aria-labelledby="step-time">
            <h2 id="step-time" class="mb-3 flex items-center gap-2 text-sm font-bold text-(--color-text)">
              <span class="step-num">{{ stepNumber('time') }}</span>
              زمان
            </h2>
            <SlotPicker
              :salon-id="page.salon.id"
              :service-id="serviceId"
              :worker-id="selectedWorkerId"
              :selected-slot="selectedSlot"
              @select="selectedSlot = $event"
              @clear="selectedSlot = null"
            />
          </section>

          <!-- Fills the gap between "here are the times" and the confirm card below, which only
               mounts once a slot is picked. -->
          <p v-if="!selectedSlot" class="text-center text-xs text-(--color-text-muted)">
            یک زمان را انتخاب کنید تا رزرو خود را نهایی کنید
          </p>

          <section v-if="selectedSlot" ref="confirmCardEl" aria-labelledby="step-review" class="scroll-mb-4">
            <h2 id="step-review" class="mb-2 flex items-center gap-2 text-sm font-bold text-(--color-text)">
              <span class="step-num">{{ stepNumber('review') }}</span>
              {{ manualApproval ? 'بررسی و ارسال درخواست' : 'بررسی و تایید' }}
            </h2>
            <BaseCard class="space-y-4 text-sm">
              <!-- Restates exactly which time is about to be booked, so a customer who has scrolled
                   past the picker can still see (and trust) what the button below will submit. -->
              <p data-testid="selected-slot-summary" class="flex items-center gap-1.5 font-bold text-(--color-text)">
                <BaseIcon name="calendar" :size="16" class="shrink-0 text-(--color-text-muted)" />
                {{ formatAppointment(selectedSlot) }}
              </p>
              <p v-if="page.workers.length" class="flex items-center gap-1.5 text-(--color-text-muted)">
                <BaseIcon name="user" :size="16" class="shrink-0" />
                {{ selectedWorkerLabel }}
              </p>
              <!-- whitespace-nowrap keeps the badge and each price atomic (a price broken between
                   its digits and "تومان" is the money figure rendered as noise); the label absorbs
                   the difference, with flex-wrap on the price group as the last resort. -->
              <div class="flex items-center justify-between gap-2">
                <span>قیمت کامل</span>
                <span class="flex flex-wrap items-center justify-end gap-2">
                  <span
                    v-if="activeDiscountPercent"
                    class="whitespace-nowrap rounded-full bg-(--color-danger-soft) px-2 py-0.5 text-xs font-bold text-(--color-danger)"
                  >
                    ٪{{ activeDiscountPercent.toLocaleString('fa-IR') }} تخفیف
                  </span>
                  <span class="flex flex-col items-end whitespace-nowrap leading-tight">
                    <span v-if="activeDiscountPercent" dir="ltr" class="tnum text-xs text-(--color-text-muted) line-through">
                      {{ formatToman(page.service.price) }}
                    </span>
                    <span class="font-bold text-(--color-text)"><span dir="ltr" class="tnum">{{ formatToman(displayPrice) }}</span> تومان</span>
                  </span>
                </span>
              </div>
              <!-- All four of these are specifically about an ONLINE deposit -- collecting it,
                   applying wallet credit toward it, and its refund window. With the platform's
                   online-payment flag off the API never opens a payment session or debits wallet
                   (createHold's own requiresPayment/wallet-debit gating), so showing any of this
                   would promise a step that isn't going to happen. The wallet checkbox only
                   appears when there's an actual balance to spend. -->
              <label
                v-if="walletBalanceToman && featureFlags.onlinePaymentEnabled"
                class="flex items-center gap-2 rounded-xl border border-(--color-border) px-3 py-2 text-(--color-text)"
              >
                <input v-model="applyWalletBalance" type="checkbox" class="h-4 w-4 shrink-0" />
                <span>استفاده از موجودی کیف پول (<span dir="ltr" class="tnum">{{ formatToman(walletBalanceToman) }}</span> تومان)</span>
              </label>
              <p v-if="depositDueOnline !== null && featureFlags.onlinePaymentEnabled">
                {{ manualApproval ? 'بیعانه آنلاین (پس از تایید سالن)' : 'بیعانه آنلاین' }}:
                <span dir="ltr" class="tnum">{{ formatToman(depositDueOnline) }}</span> تومان
                <span v-if="walletAmountToApply > 0" class="text-(--color-text-muted)">
                  (<span dir="ltr" class="tnum">{{ formatToman(walletAmountToApply) }}</span> تومان از کیف پول)
                </span>
              </p>
              <p v-if="page.terms && featureFlags.onlinePaymentEnabled" class="text-(--color-text-muted)">لغو رایگان تا {{ page.terms.cancellationWindowHours.toLocaleString('fa-IR') }} ساعت قبل از نوبت</p>
              <!-- Non-refundable-by-default disclosure -- calm/muted, not danger-red. Numbers come
                   exclusively from /platform-config/booking-terms above. -->
              <p v-if="page.terms && featureFlags.onlinePaymentEnabled" class="text-(--color-text-muted)">بعد از این زمان، بیعانه قابل بازگشت نیست</p>
              <!-- Always shown (not behind the payment flag): the cancellation policy applies to a free booking too. -->
              <NuxtLink
                to="/booking-policy"
                data-testid="booking-policy-link"
                class="inline-flex min-h-11 items-center text-(--color-accent-text) underline underline-offset-2 hover:text-(--color-text)"
              >
                قوانین رزرو و لغو نوبت
              </NuxtLink>

              <div v-if="featureFlags.couponsEnabled" class="space-y-2 border-t border-(--color-border) pt-4">
                <div class="flex items-end gap-2">
                  <!-- role="alert" scoped to just the field so an invalid-coupon message is announced
                       without also re-announcing the adjacent "اعمال" button. min-w-0 is required:
                       an <input>'s min-content width would otherwise overflow the card at 320px. -->
                  <div role="alert" aria-live="assertive" class="min-w-0 flex-1">
                    <BaseInput
                      v-model="couponCode"
                      type="text"
                      label="کد تخفیف دارید؟"
                      placeholder="کد تخفیف (اختیاری)"
                      :error="couponError"
                    />
                  </div>
                  <BaseButton
                    type="button"
                    variant="secondary"
                    class="shrink-0"
                    :loading="couponApplying"
                    :disabled="!couponCode.trim()"
                    @click="applyCoupon"
                  >
                    اعمال
                  </BaseButton>
                </div>
                <!-- Two honest outcomes for a VALID coupon: it beat the service's own discount
                     (success green, with the amount it saved), or it didn't (muted, stating plainly
                     that the price is unchanged). Both inside one aria-live region. -->
                <p
                  v-if="appliedCoupon"
                  aria-live="polite"
                  class="flex items-start gap-1 text-xs"
                  :class="couponSavings ? 'text-(--color-success)' : 'text-(--color-text-muted)'"
                >
                  <BaseIcon :name="couponSavings ? 'check-circle' : 'alert-circle'" :size="14" class="shrink-0" />
                  <span v-if="couponSavings">شما <span dir="ltr" class="tnum">{{ formatToman(couponSavings) }}</span> تومان صرفه‌جویی کردید</span>
                  <span v-else>این کد تخفیف معتبر است، اما از تخفیف فعلی این خدمت بیشتر نیست؛ قیمت تغییری نمی‌کند</span>
                </p>
              </div>

              <!-- The button must not promise what the next tap actually does. In a manual-approval
                   salon this submits a REQUEST and opens no payment at all, so "پرداخت و رزرو" would
                   be wrong on both halves. Muted, sitting directly on the button it qualifies. -->
              <p v-if="manualApproval" data-testid="manual-approval-note" class="flex items-start gap-1.5 text-xs text-(--color-text-muted)">
                <BaseIcon name="clock" :size="14" class="mt-0.5 shrink-0" />
                {{ featureFlags.onlinePaymentEnabled
                  ? 'این سالن نوبت‌ها را دستی تایید می‌کند؛ اکنون مبلغی پرداخت نمی‌کنید و پس از تایید سالن پرداخت انجام می‌شود.'
                  : 'این سالن نوبت‌ها را دستی تایید می‌کند؛ هزینه به صورت نقدی در سالن دریافت می‌شود.' }}
              </p>

              <!-- Desktop submits from the sticky summary beside the page (one submit per view). -->
              <div ref="confirmButtonEl" class="lg:hidden">
                <BaseButton block size="lg" data-testid="confirm-booking-button" :loading="submitting" @click="confirmBooking">
                  {{ submitLabel }}
                </BaseButton>
              </div>
            </BaseCard>
          </section>

          <!-- Deliberately outside the `selectedSlot` block above: confirmBooking() resets
          selectedSlot to null in the same branch that sets this message (a 409, or any non-coupon
          failure), so nesting it inside that v-if would make the error disappear the instant it's
          set. The coupon-rejected-at-submit branch keeps the slot, so its message renders here
          with the confirm sheet still open above it. -->
          <p v-if="submitError" role="alert" aria-live="assertive" class="text-(--color-danger) text-sm">{{ submitError }}</p>
        </template>
      </div>

      <!-- Desktop: the booking summary, sticky beside the steps -- what is about to be booked,
           at what price, and the one submit action. Short enough never to outgrow the viewport. -->
      <aside v-if="bookableOnline" class="hidden lg:block">
        <div data-testid="booking-aside" class="sticky top-20 space-y-4 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-5 text-sm shadow-(--shadow-md)">
          <h2 class="font-bold text-(--color-text)">خلاصه رزرو</h2>
          <dl class="space-y-2.5">
            <div class="flex justify-between gap-3">
              <dt class="text-(--color-text-muted)">سالن</dt>
              <dd class="min-w-0 break-words text-end text-(--color-text)">{{ page.salon.name }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-(--color-text-muted)">خدمت</dt>
              <dd class="min-w-0 break-words text-end text-(--color-text)">{{ page.service.name }}</dd>
            </div>
            <div v-if="page.workers.length" class="flex justify-between gap-3">
              <dt class="text-(--color-text-muted)">متخصص</dt>
              <dd class="min-w-0 break-words text-end text-(--color-text)">{{ selectedWorkerLabel }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-(--color-text-muted)">زمان</dt>
              <dd class="text-end" :class="selectedSlot ? 'font-semibold text-(--color-text)' : 'text-(--color-text-muted)'">
                {{ selectedSlot ? formatAppointment(selectedSlot) : 'هنوز انتخاب نشده' }}
              </dd>
            </div>
            <div class="flex justify-between gap-3 border-t border-(--color-border) pt-2.5">
              <dt class="text-(--color-text-muted)">قیمت</dt>
              <dd class="font-bold whitespace-nowrap text-(--color-text)"><span dir="ltr" class="tnum">{{ formatToman(displayPrice) }}</span> تومان</dd>
            </div>
            <div v-if="depositDueOnline !== null && featureFlags.onlinePaymentEnabled" class="flex justify-between gap-3">
              <dt class="text-(--color-text-muted)">{{ manualApproval ? 'بیعانه (پس از تایید)' : 'بیعانه' }}</dt>
              <dd class="whitespace-nowrap text-(--color-text)"><span dir="ltr" class="tnum">{{ formatToman(depositDueOnline) }}</span> تومان</dd>
            </div>
          </dl>
          <p v-if="!featureFlags.onlinePaymentEnabled" class="text-xs text-(--color-text-muted)">بیعانه‌ای دریافت نمی‌شود؛ هزینه در سالن پرداخت می‌شود.</p>
          <BaseButton
            block
            size="lg"
            data-testid="aside-confirm-booking-button"
            :disabled="!selectedSlot"
            :loading="submitting"
            @click="confirmBooking"
          >
            {{ selectedSlot ? submitLabel : 'ابتدا زمان را انتخاب کنید' }}
          </BaseButton>
          <p v-if="submitError" class="text-xs text-(--color-danger)">{{ submitError }}</p>
        </div>
      </aside>
    </div>

    <!-- Phones: once a time is picked, the chosen time, the real price and the submit action stay
         at the bottom edge (this route has no tab bar), except while the confirm card's own
         button is visible. Same action, same label, same handler as that button. -->
    <Transition
      enter-active-class="transition-transform duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="translate-y-full"
      leave-active-class="transition-transform duration-150 ease-in motion-reduce:transition-none"
      leave-to-class="translate-y-full"
    >
      <div
        v-if="bookableOnline && showStickyBar"
        data-testid="booking-sticky-bar"
        class="fixed inset-x-0 bottom-0 z-40 border-t border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-lg) lg:hidden"
        style="padding-bottom: env(safe-area-inset-bottom)"
      >
        <div class="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div class="min-w-0 text-sm">
            <p class="truncate font-semibold text-(--color-text)">{{ formatDateTime(selectedSlot!) }}</p>
            <p class="text-(--color-text-muted)"><span dir="ltr" class="tnum font-bold text-(--color-text)">{{ formatToman(displayPrice) }}</span> تومان</p>
          </div>
          <BaseButton class="shrink-0" data-testid="sticky-confirm-booking-button" :loading="submitting" @click="confirmBooking">
            {{ submitLabel }}
          </BaseButton>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.step-num {
  display: inline-flex;
  height: 1.5rem;
  width: 1.5rem;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: var(--color-surface-subtle);
  color: var(--color-text);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
</style>
