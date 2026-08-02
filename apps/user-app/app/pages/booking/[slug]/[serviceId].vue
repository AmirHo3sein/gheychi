<script setup lang="ts">
import { applyDiscount } from '../../../utils/discount'

interface Salon { id: string; name: string; address: string }
interface SalonServiceItem { id: string; name: string; price: number; durationMin: number; discountPercent: number | null }
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
const slug = route.params.slug as string
const serviceId = route.params.serviceId as string
const { apiFetch } = useApi()

const { data: page } = await useAsyncData(`booking-${slug}-${serviceId}`, async () => {
  const [salonRes, servicesRes, termsRes, workersRes] = await Promise.all([
    apiFetch<Salon>(`/salons/${slug}`, { silent: true }),
    apiFetch<SalonServiceItem[]>(`/salons/${slug}/services`, { silent: true }),
    apiFetch<BookingTerms>('/platform-config/booking-terms', { silent: true }),
    apiFetch<SalonWorker[]>(`/salons/${slug}/workers`, { silent: true }),
  ])
  const service = servicesRes.data?.find((s) => s.id === serviceId)
  if (!salonRes.data || !service) return null
  return { salon: salonRes.data, service, terms: termsRes.data, workers: workersRes.data ?? [] }
})

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Service not found' })
}

// null = "any available staff", exactly today's unchanged default.
const selectedWorkerId = ref<string | null>(null)

// redirectOn401: false -- an anonymous customer can browse this whole page before ever
// logging in (login only happens at confirmBooking's own 401 branch), so a guest's wallet
// lookup failing quietly (no balance to show) must not force-redirect them off a page they
// haven't asked to log in for yet. silent: true for the same reason: no toast for a lookup
// the customer never triggered themselves.
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

// A coupon rejection from POST /bookings arrives as a plain 400 with no machine-readable
// code, so the only signal available is that the message names the coupon -- "کد تخفیف"
// appears in every one of CouponsService.resolveAndValidate's rejections and in createHold's
// own duplicate-redemption catch. Copy-coupled by necessity; an error code on the response
// body would make this robust (reported upstream).
function mentionsCoupon(message: string): boolean {
  return message.includes('کد تخفیف')
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
      (error?.status === 400 ? customerFacingMessage(error.message) : null) ??
      'بررسی کد تخفیف ممکن نشد، لطفا دوباره تلاش کنید'
    return
  }
  appliedCoupon.value = { ...data, code }
}

async function confirmBooking() {
  if (!selectedSlot.value) return
  submitting.value = true
  submitError.value = ''
  const { data, error } = await apiFetch<{ booking: { id: string }; paymentUrl: string }>('/bookings', {
    method: 'POST',
    body: {
      salonId: page.value!.salon.id,
      serviceId,
      startsAt: selectedSlot.value,
      couponCode: appliedCoupon.value ? appliedCoupon.value.code : undefined,
      applyWalletBalance: applyWalletBalance.value || undefined,
      workerId: selectedWorkerId.value || undefined,
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
    if (error?.status === 409) {
      submitError.value = 'این نوبت همین الان رزرو شد، لطفا زمان دیگری را انتخاب کنید'
      selectedSlot.value = null
      return
    }

    const reason = error?.status === 400 ? customerFacingMessage(error.message) : null

    // createHold re-validates the coupon inside its own transaction, so a code that passed
    // the preview minutes ago can still be refused here (expired in between, redemption cap
    // filled by someone else). That refusal used to become "an error occurred, try again"
    // AND cleared the slot -- so the customer re-picked a slot, failed identically, and had
    // no way to learn that the coupon was the blocker. The dead code is dropped instead and
    // the slot is deliberately KEPT: the slot was never the problem, and the retry now
    // succeeds without the code.
    if (appliedCoupon.value && reason && mentionsCoupon(reason)) {
      appliedCoupon.value = null
      couponError.value = reason
      submitError.value = 'کد تخفیف از این رزرو برداشته شد؛ می‌توانید بدون آن پرداخت را ادامه دهید'
      return
    }

    // Anything else (a stale/past slot, a server error) genuinely invalidates the chosen
    // slot, so clearing it and making the customer re-pick is the right recovery.
    submitError.value = reason ?? 'خطایی رخ داد، لطفا دوباره تلاش کنید'
    selectedSlot.value = null
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
  <div v-if="page" class="p-4 space-y-4">
    <div>
      <h1 class="text-xl font-bold text-(--color-text)">{{ page.service.name }}</h1>
      <p class="text-sm">{{ page.salon.name }} — {{ page.salon.address }}</p>
    </div>

    <!-- Optional -- omitted (selectedWorkerId stays null) means "any available staff",
         unchanged from before this picker existed. Placed before SlotPicker because the
         choice narrows which slots are even offered, not just who shows up for one
         already picked. -->
    <div v-if="page.workers.length" class="flex gap-2 overflow-x-auto pb-1">
      <button
        type="button"
        :aria-pressed="selectedWorkerId === null"
        class="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors"
        :class="selectedWorkerId === null
          ? 'bg-(--color-accent-strong) text-white'
          : 'border border-(--color-border) bg-(--color-surface-card) text-(--color-text) hover:bg-(--color-surface-subtle)'"
        @click="selectedWorkerId = null"
      >
        هر متخصص در دسترس
      </button>
      <button
        v-for="worker in page.workers"
        :key="worker.id"
        type="button"
        :aria-pressed="selectedWorkerId === worker.id"
        class="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors"
        :class="selectedWorkerId === worker.id
          ? 'bg-(--color-accent-strong) text-white'
          : 'border border-(--color-border) bg-(--color-surface-card) text-(--color-text) hover:bg-(--color-surface-subtle)'"
        @click="selectedWorkerId = worker.id"
      >
        {{ worker.name }}
      </button>
    </div>

    <!-- selected-slot feeds SlotPicker's own selectedSlot prop so it can render which slot is
         actually selected (aria-pressed + accent-strong fill) rather than only emitting 'select'
         with no feedback loop back in. -->
    <SlotPicker
      :salon-id="page.salon.id"
      :service-id="serviceId"
      :worker-id="selectedWorkerId"
      :selected-slot="selectedSlot"
      @select="selectedSlot = $event"
    />

    <BaseCard v-if="selectedSlot" class="space-y-4 text-sm">
      <!-- At 320px the label, the discount badge and a seven-figure price want ~265px of
           the card's 254px content box, so something has to give -- and it must not be the
           numbers. whitespace-nowrap keeps the badge and each price atomic (a price broken
           between its digits and "تومان", or a badge reading "٪۳۰" over "تخفیف", is the
           money figure rendered as noise); the gap and the label absorb the difference,
           with flex-wrap on the price group as the last resort if that still isn't enough. -->
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
            <span v-if="activeDiscountPercent" class="text-xs text-(--color-text-muted) line-through">
              {{ page.service.price.toLocaleString('fa-IR') }}
            </span>
            <span class="font-bold text-(--color-text)">{{ displayPrice.toLocaleString('fa-IR') }} تومان</span>
          </span>
        </span>
      </div>
      <!-- Only offered when there's an actual balance to spend -- an unauthenticated
           guest gets walletBalanceToman: 0 from the quiet (redirectOn401: false) lookup
           above, so the checkbox simply never appears for them rather than nudging a
           guest toward a login they haven't asked for yet. -->
      <label
        v-if="walletBalanceToman"
        class="flex items-center gap-2 rounded-xl border border-(--color-border) px-3 py-2 text-(--color-text)"
      >
        <input v-model="applyWalletBalance" type="checkbox" class="h-4 w-4 shrink-0" />
        <span>استفاده از موجودی کیف پول ({{ walletBalanceToman.toLocaleString('fa-IR') }} تومان)</span>
      </label>
      <p v-if="depositDueOnline !== null">
        پیش‌پرداخت آنلاین: {{ depositDueOnline.toLocaleString('fa-IR') }} تومان
        <span v-if="walletAmountToApply > 0" class="text-(--color-text-muted)">
          ({{ walletAmountToApply.toLocaleString('fa-IR') }} تومان از کیف پول)
        </span>
      </p>
      <p v-if="page.terms" class="text-(--color-text-muted)">لغو رایگان تا {{ page.terms.cancellationWindowHours }} ساعت قبل از نوبت</p>
      <!-- Non-refundable-by-default disclosure (Product Principle #3) -- calm/muted, not
           danger-red: this informs what happens after the free-cancel window, it doesn't
           alarm. Numbers still come exclusively from /platform-config/booking-terms above. -->
      <p v-if="page.terms" class="text-(--color-text-muted)">بعد از این زمان، پیش‌پرداخت قابل بازگشت نیست</p>

      <div class="space-y-2 border-t border-(--color-border) pt-4">
        <div class="flex items-end gap-2">
          <!-- role="alert" scoped to just the field (label+input+BaseInput's own error
               message), not the whole row, so an invalid-coupon message is announced to
               screen readers without also re-announcing the adjacent "اعمال" button.
               min-w-0 is required, not cosmetic: a flex item's automatic minimum size is
               its min-content width, and an <input>'s min-content width is its intrinsic
               size attribute default (~180px in Chrome), NOT the `w-full` it's styled
               with -- percentages resolve to auto during intrinsic sizing. So this wrapper
               refuses to shrink past ~210px, which together with the 72px "اعمال" button
               overflows the card's 254px content box at 320px. min-w-0 lets it shrink to
               the width actually available; shrink-0 keeps the button at its full label
               width instead of letting "اعمال" get squeezed. -->
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
        <!-- Two honest outcomes for a VALID coupon, and the color carries which one it is:
             it beat the service's own discount (success green, with the amount it saved), or
             it didn't (muted, stating plainly that the price is unchanged). The old fallback
             here said "کد تخفیف با موفقیت اعمال شد" for the second case, which -- next to a
             price that hadn't moved -- read as either a bug or a broken promise. Both stay
             inside the one aria-live region so the swap is announced, not just recolored. -->
        <p
          v-if="appliedCoupon"
          aria-live="polite"
          class="flex items-start gap-1 text-xs"
          :class="couponSavings ? 'text-(--color-success)' : 'text-(--color-text-muted)'"
        >
          <BaseIcon :name="couponSavings ? 'check-circle' : 'alert-circle'" :size="14" class="shrink-0" />
          <span v-if="couponSavings">شما {{ couponSavings.toLocaleString('fa-IR') }} تومان صرفه‌جویی کردید</span>
          <span v-else>این کد تخفیف معتبر است، اما از تخفیف فعلی این خدمت بیشتر نیست؛ قیمت تغییری نمی‌کند</span>
        </p>
      </div>

      <BaseButton block size="lg" data-testid="confirm-booking-button" :loading="submitting" @click="confirmBooking">
        پرداخت و رزرو
      </BaseButton>
    </BaseCard>

    <!-- Deliberately outside the `selectedSlot` block above: confirmBooking() resets
    selectedSlot to null in the same branch that sets this message (a 409, or any non-coupon
    failure), so nesting it inside that v-if would make the error disappear the instant it's
    set. The coupon-rejected-at-submit branch keeps the slot, so its message renders here
    with the confirm sheet still open above it -- which is the point: the retry is one tap
    away and no longer needs the code. -->
    <p v-if="submitError" role="alert" aria-live="assertive" class="text-(--color-danger) text-sm">{{ submitError }}</p>
  </div>
</template>
