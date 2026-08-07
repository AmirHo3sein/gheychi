<script setup lang="ts">
interface BookingDetail {
  id: string
  salonName: string
  serviceName: string
  workerName: string | null
  startsAt: string
  priceSnapshot: number
  depositAmount: number
  walletAmountUsed: number | null
  status: 'pending_payment' | 'confirmed' | 'completed' | 'cancelled_by_user' | 'cancelled_by_salon' | 'expired' | 'no_show'
  refundStatus: 'pending' | 'done' | null
}

// Mirrors bookings/index.vue's own interface/const of the same names -- this codebase's
// per-file DTO/const convention rather than a shared module.
interface MyReview {
  id: string
  bookingId: string
  rating: number
  comment: string | null
  workerRating: number | null
  status: 'published' | 'rejected' | 'withdrawn'
  editableUntil: string
  canEdit: boolean
}

const CANCELLABLE_STATUSES: BookingDetail['status'][] = ['pending_payment', 'confirmed']

const route = useRoute()
const { apiFetch } = useApi()

const { data: booking, refresh } = await useAsyncData(`booking-detail-${route.params.id}`, async () => {
  const { data } = await apiFetch<BookingDetail>(`/bookings/${route.params.id}`, { silent: true })
  return data
})

if (!booking.value) {
  throw createError({ statusCode: 404, statusMessage: 'Booking not found' })
}

// The caller's own review for THIS booking (a review only ever exists for a completed
// one), so the action below can offer editing an existing review rather than a second
// submission the API can only answer with a 409. Scoped server-side to req.user; the
// bookingId filter keeps it to one row instead of the caller's whole review history.
const { data: myReview, refresh: refreshReview } = await useAsyncData(
  `booking-review-${route.params.id}`,
  async () => {
    if (booking.value?.status !== 'completed') return null
    const { data } = await apiFetch<MyReview[]>('/reviews/mine', {
      query: { bookingId: route.params.id },
      silent: true,
    })
    return data?.[0] ?? null
  },
)

const retrying = ref(false)

async function retryPayment() {
  if (!booking.value) return
  retrying.value = true
  const { data } = await apiFetch<{ paymentUrl: string }>(`/bookings/${booking.value.id}/retry-payment`, { method: 'POST' })
  retrying.value = false
  if (data) await navigateTo(data.paymentUrl, { external: true })
}

const cancelling = ref(false)

// A simple, direct confirm rather than duplicating bookings/index.vue's dedicated
// cancel-confirmation dialog (which surfaces a refund-outcome preview computed from
// /platform-config/booking-terms) -- this page just needs capability parity, not
// the exact same UI. Matches the native-confirm pattern already used for
// deleteReview in ReviewPromptModal.vue.
async function cancelBooking() {
  if (!booking.value) return
  if (!confirm('این نوبت لغو شود؟')) return
  cancelling.value = true
  const { error } = await apiFetch(`/bookings/${booking.value.id}/cancel`, { method: 'POST' })
  cancelling.value = false
  if (!error) await refresh()
}

const reviewOpen = ref(false)

// A withdrawn review has no label -- reviews_booking_uidx keeps that booking
// permanently un-reviewable, so the template shows a note instead of a button.
const reviewButtonLabel = computed(() => {
  if (!myReview.value) return 'ثبت نظر'
  return myReview.value.canEdit ? 'ویرایش نظر' : 'مشاهده نظر'
})
</script>

<template>
  <!-- Top-level guard, not just the `booking!` assertions below: when the createError(404) throw
       above rejects this component's async setup, Vue's Suspense still runs one render pass of
       this template with `booking` at its pre-fetch value (undefined) before the rejection is
       handled. Without this v-if, that pass throws inside the render function itself (an
       unhandled rejection, not the createError) -- see salons/[slug].vue, which this mirrors. -->
  <div v-if="booking" class="mx-auto max-w-2xl space-y-4 p-4">
    <!-- break-words on the card, not per line: overflow-wrap inherits, and every field in
         here (salon name, service name, worker name) is provider-authored free text that
         can arrive as one unbreakable token. -->
    <BaseCard class="space-y-2 text-sm break-words">
      <h1 class="text-lg font-bold text-(--color-text)">{{ booking.salonName }}</h1>
      <p class="text-(--color-text)">{{ booking.serviceName }}</p>
      <p v-if="booking.workerName" class="text-(--color-text-muted)">کارمند: {{ booking.workerName }}</p>
      <p class="flex items-center gap-1.5 text-(--color-text-muted)">
        <BaseIcon name="calendar" :size="14" />
        {{ new Date(booking.startsAt).toLocaleString('fa-IR') }}
      </p>
      <div class="space-y-1 border-t border-(--color-border) pt-2">
        <p>مبلغ کل: {{ booking.priceSnapshot.toLocaleString('fa-IR') }} تومان</p>
        <p>پیش‌پرداخت: {{ booking.depositAmount.toLocaleString('fa-IR') }} تومان</p>
        <!-- depositAmount above is already what's charged online (post-wallet) --
             this line exists only so the reduction is traceable back to the wallet,
             mirroring booking.entity.ts's own walletAmountUsed doc comment. -->
        <p v-if="booking.walletAmountUsed" class="text-(--color-text-muted)">
          {{ booking.walletAmountUsed.toLocaleString('fa-IR') }} تومان از کیف پول شما کسر شد
        </p>
      </div>
    </BaseCard>

    <!-- Refund status: "pending" and "done" are opposite emotional states and must not
         share a color. "pending" is a neutral, in-progress fact (not an error) so it gets
         the muted-text treatment, not an alarming or accent color; "done" is a genuine
         confirmation and gets --color-success, matching bookings/index.vue's status
         badges. Neither uses plain --color-accent as body text (WCAG AA contrast). -->
    <BaseCard v-if="booking.refundStatus" data-testid="refund-status-card" class="text-sm">
      <p v-if="booking.refundStatus === 'pending'" class="flex items-center gap-1.5 text-(--color-text-muted)">
        <BaseIcon name="clock" :size="14" />
        بازگشت وجه در حال انجام است
      </p>
      <p v-else class="flex items-center gap-1.5 text-(--color-success)">
        <BaseIcon name="check-circle" :size="14" />
        وجه بازگردانده شد
      </p>
    </BaseCard>

    <div
      v-if="CANCELLABLE_STATUSES.includes(booking.status) || booking.status === 'pending_payment' || booking.status === 'completed'"
      class="flex flex-wrap items-center gap-2"
    >
      <BaseButton
        v-if="booking.status === 'pending_payment'"
        data-testid="retry-payment-button"
        :loading="retrying"
        @click="retryPayment"
      >
        تکمیل پرداخت
      </BaseButton>

      <BaseButton
        v-if="CANCELLABLE_STATUSES.includes(booking.status)"
        variant="danger"
        data-testid="cancel-booking-button"
        :loading="cancelling"
        @click="cancelBooking"
      >
        لغو نوبت
      </BaseButton>

      <template v-if="booking.status === 'completed'">
        <BaseButton
          v-if="myReview?.status !== 'withdrawn'"
          variant="secondary"
          data-testid="review-booking-button"
          @click="reviewOpen = true"
        >
          {{ reviewButtonLabel }}
        </BaseButton>
        <p v-else data-testid="review-withdrawn-note" class="text-sm text-(--color-text-muted)">
          نظر شما برای این نوبت حذف شده است
        </p>
      </template>
    </div>

    <NuxtLink to="/bookings" class="block text-sm text-(--color-text) hover:underline">بازگشت به نوبت‌های من</NuxtLink>

    <ReviewPromptModal
      v-if="reviewOpen"
      :booking-id="booking.id"
      :worker-name="booking.workerName"
      :review="myReview"
      @changed="refreshReview"
      @close="reviewOpen = false"
    />
  </div>
</template>
