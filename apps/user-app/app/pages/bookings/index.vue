<script setup lang="ts">
import type { IconName } from '~/components/ui/BaseIcon.vue'

interface BookingItem {
  id: string
  salonName: string
  serviceName: string
  workerName: string | null
  startsAt: string
  priceSnapshot: number
  depositAmount: number
  status: 'pending_payment' | 'confirmed' | 'completed' | 'cancelled_by_user' | 'cancelled_by_salon' | 'expired' | 'no_show'
}

// Mirrors booking/[slug]/[serviceId].vue's local interface -- same
// /platform-config/booking-terms endpoint, kept in sync per this codebase's
// per-file DTO convention rather than a shared type.
interface BookingTerms { depositPercent: number; depositMinToman: number; cancellationWindowHours: number }

// GET /reviews/mine -- the caller's own reviews, so a completed booking that already
// has one offers "ویرایش نظر" instead of a "ثبت نظر" button whose only possible outcome
// is a 409. `canEdit` is the server's edit-window verdict (platform_config's
// review_edit_window_hours), never recomputed here.
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

const { apiFetch } = useApi()
const bookings = ref<BookingItem[]>([])
const terms = ref<BookingTerms | null>(null)
const reviewByBookingId = ref<Record<string, MyReview>>({})
const loading = ref(true)
const reviewingBooking = ref<BookingItem | null>(null)

const STATUS_META: Record<BookingItem['status'], { label: string; icon: IconName; badgeClass: string }> = {
  // text-(--color-text), not accent-strong: accent-strong on accent-soft is 4.88:1 in light
  // mode (passes) but only 2.11:1 in dark mode (fails WCAG AA) -- found during the profile.vue
  // fix pass, same root cause, verified via the WCAG relative-luminance formula.
  pending_payment: { label: 'در انتظار پرداخت', icon: 'clock', badgeClass: 'bg-(--color-accent-soft) text-(--color-text)' },
  confirmed: { label: 'تایید شده', icon: 'check-circle', badgeClass: 'bg-(--color-accent-soft) text-(--color-text)' },
  completed: { label: 'انجام شده', icon: 'check-circle', badgeClass: 'bg-(--color-success)/10 text-(--color-success)' },
  cancelled_by_user: { label: 'لغو شده توسط شما', icon: 'x', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
  cancelled_by_salon: { label: 'لغو شده توسط سالن', icon: 'x', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
  expired: { label: 'منقضی شده', icon: 'alert-circle', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
  no_show: { label: 'عدم مراجعه', icon: 'alert-circle', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
}

const CANCELLABLE_STATUSES: BookingItem['status'][] = ['pending_payment', 'confirmed']

// Split out of load() so a review submitted/edited/deleted in the modal can refresh
// just this slice, without flipping the whole list back to its loading state.
async function loadReviews() {
  const { data } = await apiFetch<MyReview[]>('/reviews/mine', { silent: true })
  reviewByBookingId.value = Object.fromEntries((data ?? []).map((review) => [review.bookingId, review]))
}

async function load() {
  loading.value = true
  const [bookingsRes, termsRes] = await Promise.all([
    apiFetch<BookingItem[]>('/bookings/mine', { silent: true }),
    apiFetch<BookingTerms>('/platform-config/booking-terms', { silent: true }),
    loadReviews(),
  ])
  bookings.value = bookingsRes.data ?? []
  terms.value = termsRes.data ?? null
  loading.value = false
}

onMounted(load)

function reviewFor(bookingId: string): MyReview | null {
  return reviewByBookingId.value[bookingId] ?? null
}

// A withdrawn review has no label here -- reviews_booking_uidx keeps the booking
// permanently un-reviewable, so the card shows a note instead of any button.
function reviewButtonLabel(bookingId: string): string {
  const review = reviewFor(bookingId)
  if (!review) return 'ثبت نظر'
  return review.canEdit ? 'ویرایش نظر' : 'مشاهده نظر'
}

const retryingId = ref<string | null>(null)

async function retryPayment(id: string) {
  retryingId.value = id
  const { data } = await apiFetch<{ paymentUrl: string }>(`/bookings/${id}/retry-payment`, { method: 'POST' })
  retryingId.value = null
  if (data) await navigateTo(data.paymentUrl, { external: true })
}

// Cancellation confirmation -- an in-app dialog (useDialog composable, same
// role=dialog/focus-trap/Escape contract as ReportForm.vue) replacing the old bare
// native confirm(), so the actual refund outcome for THIS booking can be shown
// rather than a content-free yes/no prompt. A pending_payment booking never had a
// captured payment (BookingsService.cancel), so cancelling it is free regardless of
// the cancellation window; a confirmed booking's deposit is only refunded if the
// window (fetched from /platform-config/booking-terms, same source
// booking/[slug]/[serviceId].vue uses) hasn't yet closed.
const cancelTarget = ref<BookingItem | null>(null)
const cancelling = ref(false)

function cancelOutcomeText(booking: BookingItem): string {
  if (booking.status === 'pending_payment') {
    return 'این نوبت هنوز پرداخت نشده است؛ لغو آن هزینه‌ای برای شما ندارد.'
  }
  if (!terms.value) {
    // Fallback if /platform-config/booking-terms didn't load -- same general policy
    // wording as booking/[slug]/[serviceId].vue, combined into one sentence.
    return 'لغو رایگان تا ۴۸ ساعت قبل از نوبت، پس از آن پیش‌پرداخت قابل بازگشت نیست.'
  }
  const hoursUntilStart = (new Date(booking.startsAt).getTime() - Date.now()) / (1000 * 60 * 60)
  const windowHours = terms.value.cancellationWindowHours.toLocaleString('fa-IR')
  if (hoursUntilStart >= terms.value.cancellationWindowHours) {
    return `چون بیش از ${windowHours} ساعت به این نوبت مانده، پیش‌پرداخت شما به طور کامل بازگردانده می‌شود.`
  }
  return `چون کمتر از ${windowHours} ساعت به این نوبت مانده، پیش‌پرداخت قابل بازگشت نیست.`
}

function openCancelConfirm(booking: BookingItem) {
  cancelTarget.value = booking
}

function closeCancelConfirm() {
  if (cancelling.value) return
  cancelTarget.value = null
}

async function confirmCancel() {
  if (!cancelTarget.value) return
  cancelling.value = true
  const { error } = await apiFetch(`/bookings/${cancelTarget.value.id}/cancel`, { method: 'POST' })
  cancelling.value = false
  if (!error) {
    cancelTarget.value = null
    await load()
  }
}

const cancelDialogRoot = ref<HTMLElement | null>(null)
const { titleId: cancelTitleId } = useDialog(cancelDialogRoot, { onClose: closeCancelConfirm })
</script>

<template>
  <div class="p-4 space-y-4">
    <h1 class="text-xl font-bold text-(--color-text)">نوبت‌های من</h1>

    <p v-if="loading" class="flex items-center justify-center gap-2 py-8 text-sm text-(--color-text-muted)">
      <BaseIcon name="spinner" :size="18" class="animate-spin" />
      در حال بارگذاری...
    </p>
    <p
      v-else-if="!bookings.length"
      data-testid="bookings-empty"
      class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-6 text-center text-sm text-(--color-text-muted)"
    >
      نوبتی ثبت نشده است
    </p>

    <BaseCard v-for="booking in bookings" :key="booking.id" data-testid="booking-card" class="space-y-3 text-sm">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-bold text-(--color-text)">{{ booking.salonName }} — {{ booking.serviceName }}</p>
          <p class="mt-1 flex items-center gap-1 text-(--color-text-muted)">
            <BaseIcon name="calendar" :size="14" />
            {{ new Date(booking.startsAt).toLocaleString('fa-IR') }}
          </p>
        </div>
        <span
          data-testid="booking-status-badge"
          class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-bold"
          :class="STATUS_META[booking.status].badgeClass"
        >
          <BaseIcon :name="STATUS_META[booking.status].icon" :size="13" />
          {{ STATUS_META[booking.status].label }}
        </span>
      </div>

      <div v-if="booking.status === 'pending_payment'" class="flex items-center justify-between gap-3 rounded-xl bg-(--color-danger-soft) p-3">
        <span class="flex items-center gap-1.5 text-(--color-danger)">
          <BaseIcon name="alert-circle" :size="15" />
          پرداخت این نوبت کامل نشده است
        </span>
        <BaseButton
          size="md"
          data-testid="retry-payment-button"
          :loading="retryingId === booking.id"
          @click="retryPayment(booking.id)"
        >
          تکمیل پرداخت
        </BaseButton>
      </div>

      <div class="flex flex-wrap items-center gap-2 border-t border-(--color-border) pt-3">
        <BaseButton
          v-if="CANCELLABLE_STATUSES.includes(booking.status)"
          variant="danger"
          data-testid="cancel-booking-button"
          @click="openCancelConfirm(booking)"
        >
          لغو نوبت
        </BaseButton>

        <template v-if="booking.status === 'completed'">
          <BaseButton
            v-if="reviewFor(booking.id)?.status !== 'withdrawn'"
            variant="secondary"
            data-testid="review-booking-button"
            @click="reviewingBooking = booking"
          >
            {{ reviewButtonLabel(booking.id) }}
          </BaseButton>
          <p v-else data-testid="review-withdrawn-note" class="text-(--color-text-muted)">
            نظر شما برای این نوبت حذف شده است
          </p>
        </template>

        <NuxtLink
          :to="`/bookings/${booking.id}`"
          data-testid="booking-detail-link"
          class="ms-auto inline-flex items-center gap-1 text-(--color-accent) hover:underline"
        >
          جزئیات
          <BaseIcon name="chevron-back" :size="14" />
        </NuxtLink>
      </div>
    </BaseCard>

    <ReviewPromptModal
      v-if="reviewingBooking"
      :booking-id="reviewingBooking.id"
      :worker-name="reviewingBooking.workerName"
      :review="reviewFor(reviewingBooking.id)"
      @changed="loadReviews"
      @close="reviewingBooking = null"
    />

    <div v-if="cancelTarget" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref="cancelDialogRoot"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="cancelTitleId"
        tabindex="-1"
        data-testid="cancel-confirm-dialog"
        class="w-full max-w-sm space-y-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-6 shadow-(--shadow-lg) outline-none"
      >
        <h2 :id="cancelTitleId" class="text-lg font-bold text-(--color-text)">لغو نوبت</h2>
        <p class="text-sm text-(--color-text)">{{ cancelTarget.salonName }} — {{ cancelTarget.serviceName }}</p>
        <p data-testid="cancel-confirm-refund-copy" class="text-sm text-(--color-text-muted)">
          {{ cancelOutcomeText(cancelTarget) }}
        </p>
        <div class="flex gap-2 pt-1">
          <BaseButton variant="secondary" block data-testid="cancel-confirm-dismiss" :disabled="cancelling" @click="closeCancelConfirm">
            انصراف
          </BaseButton>
          <BaseButton variant="danger" block data-testid="cancel-confirm-submit" :loading="cancelling" @click="confirmCancel">
            لغو نوبت
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
