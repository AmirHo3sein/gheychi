<script setup lang="ts">
import type { IconName } from '~/components/ui/BaseIcon.vue'
import { formatToman } from '../../utils/format-toman'

interface BookingDetail {
  id: string
  salonName: string
  serviceName: string
  workerName: string | null
  startsAt: string
  priceSnapshot: number
  depositAmount: number
  walletAmountUsed: number | null
  status:
    | 'pending_approval'
    | 'pending_payment'
    | 'confirmed'
    | 'completed'
    | 'cancelled_by_user'
    | 'cancelled_by_salon'
    | 'rejected_by_salon'
    | 'expired'
    | 'no_show'
  refundStatus: 'pending' | 'done' | null
  // Mirrors bookings/index.vue's own BookingItem fields of the same names -- the workflow
  // frozen onto the booking at creation, plus whichever backend-owned deadline (if any) it
  // is currently waiting on. Both *ExpiresAt are display only; the server enforces them.
  confirmationMode: 'automatic' | 'manual_approval'
  approvalExpiresAt: string | null
  paymentExpiresAt: string | null
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

// pending_approval is cancellable: withdrawing a request the salon hasn't answered yet goes
// through the same POST /bookings/:id/cancel, with no payment and so no refund in play.
const CANCELLABLE_STATUSES: BookingDetail['status'][] = ['pending_approval', 'pending_payment', 'confirmed']

// Mirrors bookings/index.vue's own STATUS_META -- this codebase's per-file DTO/const
// convention rather than a shared module. This page previously showed no status at all,
// which was survivable while every status was either self-evident from the actions offered
// or a refund line; it isn't once a booking can be sitting in pending_approval, where the
// single most important fact is that nothing has been paid.
const STATUS_META: Record<BookingDetail['status'], { label: string; icon: IconName; badgeClass: string }> = {
  pending_approval: { label: 'در انتظار تایید سالن', icon: 'clock', badgeClass: 'bg-(--color-accent-soft) text-(--color-text)' },
  pending_payment: { label: 'در انتظار پرداخت', icon: 'clock', badgeClass: 'bg-(--color-accent-soft) text-(--color-text)' },
  confirmed: { label: 'تایید شده', icon: 'check-circle', badgeClass: 'bg-(--color-accent-soft) text-(--color-text)' },
  completed: { label: 'انجام شده', icon: 'check-circle', badgeClass: 'bg-(--color-success)/10 text-(--color-success)' },
  cancelled_by_user: { label: 'لغو شده توسط شما', icon: 'x', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
  cancelled_by_salon: { label: 'لغو شده توسط سالن', icon: 'x', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
  rejected_by_salon: { label: 'رد شده توسط سالن', icon: 'x', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
  expired: { label: 'منقضی شده', icon: 'alert-circle', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
  no_show: { label: 'عدم مراجعه', icon: 'alert-circle', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
}

const route = useRoute()
const { apiFetch } = useApi()
const { flags: featureFlags } = useFeatureFlags()

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
  // A pending_approval booking isn't an appointment yet -- the customer is withdrawing a
  // request the salon hasn't answered, so the prompt (and the button) say exactly that.
  const prompt = booking.value.status === 'pending_approval' ? 'این درخواست لغو شود؟' : 'این نوبت لغو شود؟'
  if (!confirm(prompt)) return
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
      <!-- The heading and the badge share a row, with the badge shrink-0: the salon name is
           provider-authored free text and must be the half that wraps, never the status. -->
      <div class="flex items-start justify-between gap-3">
        <h1 class="min-w-0 text-lg font-bold text-(--color-text)">{{ booking.salonName }}</h1>
        <span
          data-testid="booking-status-badge"
          class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-bold whitespace-nowrap"
          :class="STATUS_META[booking.status].badgeClass"
        >
          <BaseIcon :name="STATUS_META[booking.status].icon" :size="13" />
          {{ STATUS_META[booking.status].label }}
        </span>
      </div>
      <p class="text-(--color-text)">{{ booking.serviceName }}</p>
      <p v-if="booking.workerName" class="text-(--color-text-muted)">کارمند: {{ booking.workerName }}</p>
      <p class="flex items-center gap-1.5 text-(--color-text-muted)">
        <BaseIcon name="calendar" :size="14" />
        {{ new Date(booking.startsAt).toLocaleString('fa-IR') }}
      </p>
      <div class="space-y-1 border-t border-(--color-border) pt-2">
        <p>مبلغ کل: <span dir="ltr" class="tnum">{{ formatToman(booking.priceSnapshot) }}</span> تومان</p>
        <!-- The label carries the tense. On a pending_approval booking this figure is what
             WILL be due if the salon says yes, and reading it as a paid amount is exactly
             the misunderstanding this whole flow has to avoid. -->
        <p>
          {{ booking.status === 'pending_approval' ? 'پیش‌پرداخت پس از تایید سالن' : 'پیش‌پرداخت' }}:
          <span dir="ltr" class="tnum">{{ formatToman(booking.depositAmount) }}</span> تومان
        </p>
        <!-- depositAmount above is already what's charged online (post-wallet) --
             this line exists only so the reduction is traceable back to the wallet,
             mirroring booking.entity.ts's own walletAmountUsed doc comment. -->
        <p v-if="booking.walletAmountUsed" class="text-(--color-text-muted)">
          <span dir="ltr" class="tnum">{{ formatToman(booking.walletAmountUsed) }}</span> تومان از کیف پول شما کسر شد
        </p>
      </div>
    </BaseCard>

    <!-- Manual-approval mode, awaiting the salon's decision. The load-bearing sentence is the
         second one: this booking has no payment behind it at all, so any copy that hints
         otherwise (a receipt, a refund, a "pay now") would be a straight lie. Muted/subtle
         surface rather than danger: nothing is wrong and there is nothing for the customer
         to fix -- the only action offered is withdrawing the request, below. -->
    <BaseCard v-if="booking.status === 'pending_approval'" data-testid="pending-approval-card" class="space-y-1.5 text-sm">
      <p class="flex items-center gap-1.5 font-bold text-(--color-text)">
        <BaseIcon name="clock" :size="15" />
        درخواست شما برای سالن ارسال شد
      </p>
      <p class="text-(--color-text-muted)">
        این نوبت پس از تایید سالن قطعی می‌شود. تا آن زمان هیچ مبلغی از شما دریافت نشده است و
        پرداخت فقط بعد از تایید سالن انجام می‌شود.
      </p>
      <p v-if="booking.approvalExpiresAt" class="text-(--color-text-muted)">
        مهلت پاسخ سالن: <RemainingTime :expires-at="booking.approvalExpiresAt" />
      </p>
    </BaseCard>

    <!-- The salon answered, and said no. Stated plainly, with the same "nothing was taken"
         reassurance -- a rejected request never reached a payment. -->
    <BaseCard v-else-if="booking.status === 'rejected_by_salon'" data-testid="rejected-card" class="space-y-1.5 text-sm">
      <p class="flex items-center gap-1.5 font-bold text-(--color-danger)">
        <BaseIcon name="x" :size="15" />
        سالن این درخواست را رد کرد
      </p>
      <p class="text-(--color-text-muted)">مبلغی از شما دریافت نشده است. می‌توانید زمان یا سالن دیگری را انتخاب کنید.</p>
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
      <!-- Next to the action it constrains, not buried in the card above. Display only: the
           button stays enabled past the deadline and the API's own refusal is what ends the
           attempt -- gating a payment button on a client clock could lock a customer out of
           a window the server still considers open. -->
      <span v-if="booking.status === 'pending_payment' && booking.paymentExpiresAt" class="text-sm text-(--color-text-muted)">
        مهلت پرداخت: <RemainingTime :expires-at="booking.paymentExpiresAt" />
      </span>

      <BaseButton
        v-if="CANCELLABLE_STATUSES.includes(booking.status)"
        variant="danger"
        data-testid="cancel-booking-button"
        :loading="cancelling"
        @click="cancelBooking"
      >
        {{ booking.status === 'pending_approval' ? 'لغو درخواست' : 'لغو نوبت' }}
      </BaseButton>

      <template v-if="booking.status === 'completed'">
        <!-- A review already on file stays viewable/editable even with the flag off (the
             API only blocks NEW create/reply while disabled, see reviews.service.ts) --
             only the net-new "ثبت نظر" path is hidden here. -->
        <BaseButton
          v-if="myReview?.status !== 'withdrawn' && (myReview || featureFlags.reviewsEnabled)"
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
