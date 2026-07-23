<script setup lang="ts">
import { applyDiscount } from '../../../utils/discount'

interface Salon { id: string; name: string; address: string }
interface SalonServiceItem { id: string; name: string; price: number; durationMin: number; discountPercent: number | null }
interface BookingTerms { depositPercent: number; depositMinToman: number; cancellationWindowHours: number }

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
  const [salonRes, servicesRes, termsRes] = await Promise.all([
    apiFetch<Salon>(`/salons/${slug}`, { silent: true }),
    apiFetch<SalonServiceItem[]>(`/salons/${slug}/services`, { silent: true }),
    apiFetch<BookingTerms>('/platform-config/booking-terms', { silent: true }),
  ])
  const service = servicesRes.data?.find((s) => s.id === serviceId)
  if (!salonRes.data || !service) return null
  return { salon: salonRes.data, service, terms: termsRes.data }
})

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Service not found' })
}

const selectedSlot = ref<string | null>(null)
const submitting = ref(false)
const submitError = ref('')

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

// "You saved X toman" -- always correct regardless of discount kind (percent or
// fixed), since it's derived from the two authoritative prices rather than from any
// percent figure. Only meaningful once a coupon is applied and it actually won
// against the service's own discount (i.e. finalPrice < originalPrice); a coupon that
// didn't beat the service discount, or a service-only discount with no coupon
// applied, has nothing coupon-specific worth calling out here.
const couponSavings = computed(() => {
  if (!appliedCoupon.value) return null
  const savings = appliedCoupon.value.originalPrice - appliedCoupon.value.finalPrice
  return savings > 0 ? savings : null
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
  return Math.max(pct, page.value.terms.depositMinToman)
})

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
    couponError.value = 'کد تخفیف نامعتبر است'
    appliedCoupon.value = null
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
    submitError.value = error?.status === 409
      ? 'این نوبت همین الان رزرو شد، لطفا زمان دیگری را انتخاب کنید'
      : 'خطایی رخ داد، لطفا دوباره تلاش کنید'
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

    <!-- selected-slot feeds SlotPicker's own selectedSlot prop so it can render which slot is
         actually selected (aria-pressed + accent-strong fill) rather than only emitting 'select'
         with no feedback loop back in. -->
    <SlotPicker
      :salon-id="page.salon.id"
      :service-id="serviceId"
      :selected-slot="selectedSlot"
      @select="selectedSlot = $event"
    />

    <BaseCard v-if="selectedSlot" class="space-y-4 text-sm">
      <div class="flex items-center justify-between">
        <span>قیمت کامل</span>
        <span class="flex items-center gap-2">
          <span
            v-if="activeDiscountPercent"
            class="rounded-full bg-(--color-danger-soft) px-2 py-0.5 text-xs font-bold text-(--color-danger)"
          >
            ٪{{ activeDiscountPercent.toLocaleString('fa-IR') }} تخفیف
          </span>
          <span class="flex flex-col items-end leading-tight">
            <span v-if="activeDiscountPercent" class="text-xs text-(--color-text-muted) line-through">
              {{ page.service.price.toLocaleString('fa-IR') }}
            </span>
            <span class="font-bold text-(--color-text)">{{ displayPrice.toLocaleString('fa-IR') }} تومان</span>
          </span>
        </span>
      </div>
      <p v-if="estimatedDeposit !== null">پیش‌پرداخت آنلاین: {{ estimatedDeposit.toLocaleString('fa-IR') }} تومان</p>
      <p v-if="page.terms" class="text-(--color-text-muted)">لغو رایگان تا {{ page.terms.cancellationWindowHours }} ساعت قبل از نوبت</p>
      <!-- Non-refundable-by-default disclosure (Product Principle #3) -- calm/muted, not
           danger-red: this informs what happens after the free-cancel window, it doesn't
           alarm. Numbers still come exclusively from /platform-config/booking-terms above. -->
      <p v-if="page.terms" class="text-(--color-text-muted)">بعد از این زمان، پیش‌پرداخت قابل بازگشت نیست</p>

      <div class="space-y-2 border-t border-(--color-border) pt-4">
        <div class="flex items-end gap-2">
          <!-- role="alert" scoped to just the field (label+input+BaseInput's own error
               message), not the whole row, so an invalid-coupon message is announced to
               screen readers without also re-announcing the adjacent "اعمال" button. -->
          <div role="alert" aria-live="assertive" class="flex-1">
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
            :loading="couponApplying"
            :disabled="!couponCode.trim()"
            @click="applyCoupon"
          >
            اعمال
          </BaseButton>
        </div>
        <p v-if="appliedCoupon" aria-live="polite" class="flex items-center gap-1 text-xs text-(--color-success)">
          <BaseIcon name="check-circle" :size="14" />
          <span v-if="couponSavings">شما {{ couponSavings.toLocaleString('fa-IR') }} تومان صرفه‌جویی کردید</span>
          <span v-else>کد تخفیف با موفقیت اعمال شد</span>
        </p>
      </div>

      <BaseButton block size="lg" data-testid="confirm-booking-button" :loading="submitting" @click="confirmBooking">
        پرداخت و رزرو
      </BaseButton>
    </BaseCard>

    <!-- Deliberately outside the `selectedSlot` block above: confirmBooking() resets
    selectedSlot to null in the same branch that sets this message (e.g. on a 409), so
    nesting it inside that v-if would make the error disappear the instant it's set. -->
    <p v-if="submitError" role="alert" aria-live="assertive" class="text-(--color-danger) text-sm">{{ submitError }}</p>
  </div>
</template>
