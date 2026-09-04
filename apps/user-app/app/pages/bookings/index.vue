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
  // Which workflow this booking runs, frozen onto the row at creation time (see the API's
  // Booking.confirmationMode) -- a salon flipping its mode later never changes what an
  // existing booking was promised. Not read directly here (the status already says
  // everything the card needs), but part of the shape every booking endpoint now returns.
  confirmationMode: 'automatic' | 'manual_approval'
  // Backend-owned deadlines: approvalExpiresAt is stamped while a manual request awaits the
  // salon's decision, paymentExpiresAt the moment a payment window opens. Display only as
  // countdowns -- see RemainingTime.vue.
  approvalExpiresAt: string | null
  paymentExpiresAt: string | null
  // Whether real money was ever captured online for this booking -- derived server-side
  // from the Payment row (paid, or since refunded). depositAmount alone can't answer this:
  // with the platform's online-payment flag off it stays non-zero on bookings nothing was
  // collected for.
  depositPaid: boolean
  // The plain Booking entity's own columns -- always present on /bookings/mine (no
  // serialization exclusion strips them), just never read by this page until now. Needed to
  // reuse SlotPicker for the reschedule dialog below: it fetches this exact salon+service's
  // live availability, and workerId narrows that to the specific staff member already
  // assigned (reschedule never changes who -- only when).
  salonId: string
  serviceId: string
  workerId: string | null
}

// Whether real money sits behind this booking. Deliberately NOT the live feature flag: a
// booking paid while the flag was on is still a paid booking after it's switched off, and
// one confirmed with nothing collected while it was off owes no refund even once it's back on.
function hasOnlineDeposit(booking: Pick<BookingItem, 'depositPaid'>): boolean {
  return booking.depositPaid === true
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
const { flags: featureFlags } = useFeatureFlags()
const bookings = ref<BookingItem[]>([])
const terms = ref<BookingTerms | null>(null)
const reviewByBookingId = ref<Record<string, MyReview>>({})
const loading = ref(true)
// A failed /bookings/mine must never render as "you have no bookings" -- that empty state
// is a claim about the customer's data, and a network blip can't be allowed to make it.
// Same retry-state pattern as account/activity.vue.
const loadError = ref(false)
const reviewingBooking = ref<BookingItem | null>(null)

const STATUS_META: Record<BookingItem['status'], { label: string; icon: IconName; badgeClass: string }> = {
  // text-(--color-text), not accent-strong: accent-strong on accent-soft is 4.88:1 in light
  // mode (passes) but only 2.11:1 in dark mode (fails WCAG AA) -- found during the profile.vue
  // fix pass, same root cause, verified via the WCAG relative-luminance formula.
  // Manual-approval mode only, and deliberately NOT a danger/alarm color: waiting on the
  // salon is a normal, in-progress state the customer can't act on and hasn't paid for --
  // nothing has gone wrong. Same accent-soft treatment as pending_payment.
  pending_approval: { label: 'در انتظار تایید سالن', icon: 'clock', badgeClass: 'bg-(--color-accent-soft) text-(--color-text)' },
  pending_payment: { label: 'در انتظار پرداخت', icon: 'clock', badgeClass: 'bg-(--color-accent-soft) text-(--color-text)' },
  confirmed: { label: 'تایید شده', icon: 'check-circle', badgeClass: 'bg-(--color-accent-soft) text-(--color-text)' },
  completed: { label: 'انجام شده', icon: 'check-circle', badgeClass: 'bg-(--color-success)/10 text-(--color-success)' },
  cancelled_by_user: { label: 'لغو شده توسط شما', icon: 'x', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
  cancelled_by_salon: { label: 'لغو شده توسط سالن', icon: 'x', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
  // Distinct from cancelled_by_salon: this request never became a booking at all, and no
  // money was ever taken for it. Shares the danger treatment because the outcome for the
  // customer is the same -- they need to book somewhere/something else.
  rejected_by_salon: { label: 'رد شده توسط سالن', icon: 'x', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
  expired: { label: 'منقضی شده', icon: 'alert-circle', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
  no_show: { label: 'عدم مراجعه', icon: 'alert-circle', badgeClass: 'bg-(--color-danger-soft) text-(--color-danger)' },
}

// pending_approval is cancellable too: withdrawing a request the salon hasn't answered yet
// is the customer's own POST /bookings/:id/cancel, with no payment and so no refund in play.
const CANCELLABLE_STATUSES: BookingItem['status'][] = ['pending_approval', 'pending_payment', 'confirmed']

// Split out of load() so a review submitted/edited/deleted in the modal can refresh
// just this slice, without flipping the whole list back to its loading state.
async function loadReviews() {
  const { data } = await apiFetch<MyReview[]>('/reviews/mine', { silent: true })
  reviewByBookingId.value = Object.fromEntries((data ?? []).map((review) => [review.bookingId, review]))
}

async function load() {
  loading.value = true
  loadError.value = false
  const [bookingsRes, termsRes] = await Promise.all([
    apiFetch<BookingItem[]>('/bookings/mine', { silent: true }),
    apiFetch<BookingTerms>('/platform-config/booking-terms', { silent: true }),
    loadReviews(),
  ])
  // Only the bookings list is load-bearing: terms/reviews failing degrade to their own
  // fallbacks (generic cancel copy, "ثبت نظر"), so they don't flip the page into an error.
  if (bookingsRes.error || !bookingsRes.data) {
    // Cleared rather than left stale: load() also re-runs after a cancel, and a card for a
    // booking that was just cancelled must not linger beside the error.
    bookings.value = []
    loadError.value = true
    loading.value = false
    return
  }
  bookings.value = bookingsRes.data
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
  // A manual-approval request that hasn't been answered yet never opened a payment window,
  // so there is nothing to refund and no cancellation window to be inside or outside of.
  if (booking.status === 'pending_approval') {
    return 'این درخواست هنوز تایید نشده و مبلغی از شما دریافت نشده است؛ لغو آن هزینه‌ای ندارد.'
  }
  if (booking.status === 'pending_payment') {
    return 'این نوبت هنوز پرداخت نشده است؛ لغو آن هزینه‌ای برای شما ندارد.'
  }
  // A confirmed booking with no payment behind it (online payment collection was off when
  // it was made): promising the deposit "will be refunded in full" would describe money that
  // never moved. There is nothing to lose and no window to be inside or outside of.
  if (!hasOnlineDeposit(booking)) {
    return 'برای این نوبت پیش‌پرداختی دریافت نشده است؛ لغو آن هزینه‌ای برای شما ندارد.'
  }
  if (!terms.value) {
    // Fallback if /platform-config/booking-terms didn't load -- same general policy
    // wording as booking/[slug]/[serviceId].vue, combined into one sentence. 24 matches
    // the seeded cancellation_window_hours (initial-schema migration), so a config fetch
    // failure can't quietly promise a longer free-cancel window than the API enforces.
    return 'لغو رایگان تا ۲۴ ساعت قبل از نوبت، پس از آن پیش‌پرداخت قابل بازگشت نیست.'
  }
  const hoursUntilStart = (new Date(booking.startsAt).getTime() - Date.now()) / (1000 * 60 * 60)
  const windowHours = terms.value.cancellationWindowHours.toLocaleString('fa-IR')
  if (hoursUntilStart >= terms.value.cancellationWindowHours) {
    return `چون بیش از ${windowHours} ساعت به این نوبت مانده، پیش‌پرداخت شما به طور کامل بازگردانده می‌شود.`
  }
  return `چون کمتر از ${windowHours} ساعت به این نوبت مانده، پیش‌پرداخت قابل بازگشت نیست.`
}

// Same wording as the card's own button, so the dialog the customer opened is
// unmistakably about the thing they clicked (a request vs. an actual appointment).
const cancelActionLabel = computed(() =>
  cancelTarget.value?.status === 'pending_approval' ? 'لغو درخواست' : 'لغو نوبت',
)

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
// The cast works around a vue-tsc/vue 3.5.42 template-ref inference mismatch (see
// useDialog.ts's own signature) -- cancelDialogRoot really is Ref<HTMLElement | null> at
// runtime.
const { titleId: cancelTitleId } = useDialog(cancelDialogRoot as unknown as Ref<HTMLElement | null>, {
  onClose: closeCancelConfirm,
})

// Reschedule -- moves the SAME booking to a new time (POST /bookings/:id/reschedule) rather
// than cancel-and-rebook, which for a within-window cancellation forfeited the deposit and
// in every case lost the booking's own history. See BookingsService.reschedule and
// 09-booking-engine.md's "Rescheduling" section for the full rule set this page deliberately
// does NOT re-derive client-side: only that the customer's ORIGINAL start (not the requested
// new one) still has to clear the cancellation window, enforced with a 409 this dialog
// surfaces via useApi's own default toast. Same one-at-a-time dialog shape as cancel above,
// and the exact same eligible statuses (CANCELLABLE_STATUSES already IS the API's
// SLOT_BLOCKING_STATUSES -- a completed/no-show booking already happened, a dead one is not
// something to resurrect by moving it).
const rescheduleTarget = ref<BookingItem | null>(null)
const rescheduling = ref(false)
// The picked replacement instant, fed by SlotPicker's own `select` emit -- reusing the exact
// picker booking/[slug]/[serviceId].vue uses for a NEW booking, since choosing a new time for
// an existing one is the same problem: real, salon-authoritative availability, not a bare
// date+time input that could offer a slot the server will just reject.
const newSlot = ref<string | null>(null)

function openRescheduleDialog(booking: BookingItem) {
  rescheduleTarget.value = booking
  newSlot.value = null
}

function closeRescheduleDialog() {
  if (rescheduling.value) return
  rescheduleTarget.value = null
}

async function confirmReschedule() {
  // Guards both a genuine double-click (matching cancelling's own established pattern) and a
  // submit attempt before a slot is actually chosen -- the button is disabled for the second
  // case too, this is the belt to that suspenders.
  if (rescheduling.value || !rescheduleTarget.value || !newSlot.value) return
  rescheduling.value = true
  const { error } = await apiFetch(`/bookings/${rescheduleTarget.value.id}/reschedule`, {
    method: 'POST',
    body: { startsAt: newSlot.value },
  })
  rescheduling.value = false
  // A 400 (past time / wrong status) or 409 (outside the cancellation window, or the new
  // slot filled from under the customer) is already toasted by useApi with the API's own
  // Persian explanation -- this dialog stays open so the customer can immediately pick a
  // different time rather than having to re-open it from the list.
  if (!error) {
    rescheduleTarget.value = null
    await load()
  }
}

const rescheduleDialogRoot = ref<HTMLElement | null>(null)
// Same vue-tsc/vue 3.5.42 template-ref inference workaround as cancelDialogRoot above.
const { titleId: rescheduleTitleId } = useDialog(rescheduleDialogRoot as unknown as Ref<HTMLElement | null>, {
  onClose: closeRescheduleDialog,
})
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4 p-4">
    <h1 class="text-xl font-bold text-(--color-text)">نوبت‌های من</h1>

    <p v-if="loading" class="flex items-center justify-center gap-2 py-8 text-sm text-(--color-text-muted)">
      <BaseIcon name="spinner" :size="18" class="animate-spin" />
      در حال بارگذاری...
    </p>
    <BaseCard v-else-if="loadError" data-testid="bookings-load-error" role="alert" class="space-y-3 text-center">
      <p class="text-sm text-(--color-text-muted)">بارگذاری نوبت‌ها با خطا مواجه شد.</p>
      <BaseButton variant="secondary" data-testid="bookings-retry-button" @click="load">تلاش مجدد</BaseButton>
    </BaseCard>
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
          <!-- The status badge is shrink-0 and up to ~135px wide ("لغو شده توسط سالن"),
               leaving this line ~110px at 320px -- both halves are provider-authored, so
               break-words is what keeps a long one inside the card. -->
          <p class="font-bold break-words text-(--color-text)">{{ booking.salonName }} — {{ booking.serviceName }}</p>
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

      <!-- Manual-approval mode: the request is with the salon and there is deliberately NO
           call to action here. Nothing has been charged yet, so offering a "pay" button
           would both fail (the API has no payment session for a pending_approval booking)
           and imply the appointment is already theirs. Muted surface rather than the
           danger-soft one pending_payment uses: waiting on someone else is not a problem
           the customer has to fix. -->
      <div
        v-if="booking.status === 'pending_approval'"
        data-testid="pending-approval-strip"
        class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-(--color-surface-subtle) p-3"
      >
        <span class="flex min-w-0 items-start gap-1.5 text-(--color-text)">
          <BaseIcon name="clock" :size="15" class="mt-0.5 shrink-0" />
          درخواست شما ثبت شد و در انتظار تایید سالن است؛ هنوز مبلغی پرداخت نشده است
        </span>
        <span v-if="booking.approvalExpiresAt" class="text-xs text-(--color-text-muted)">
          مهلت پاسخ سالن: <RemainingTime :expires-at="booking.approvalExpiresAt" />
        </span>
      </div>

      <!-- flex-wrap + shrink-0 on the button: at 320px this row has ~230px for a ~195px
           warning and a ~100px call to action. Without wrapping the button is the item
           that gives, and "تکمیل پرداخت" breaks across two lines -- the one control on the
           card that recovers an unpaid booking, rendered as the least legible thing on it.
           Wrapping drops it onto its own full-width-ish line instead. -->
      <div v-if="booking.status === 'pending_payment'" class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl bg-(--color-danger-soft) p-3">
        <span class="flex min-w-0 items-start gap-1.5 text-(--color-danger)">
          <BaseIcon name="alert-circle" :size="15" class="mt-0.5 shrink-0" />
          <span class="min-w-0">
            پرداخت این نوبت کامل نشده است
            <!-- The payment window is finite and the customer had no way to see that here.
                 Display only: the button below stays clickable past the deadline and the
                 API's own 409 is what refuses a too-late retry. -->
            <span v-if="booking.paymentExpiresAt" class="block text-xs">
              مهلت پرداخت: <RemainingTime :expires-at="booking.paymentExpiresAt" />
            </span>
          </span>
        </span>
        <BaseButton
          size="md"
          class="shrink-0"
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
          <!-- There is no appointment to cancel yet while the salon hasn't answered -- the
               customer is withdrawing a request, and the label says so. -->
          {{ booking.status === 'pending_approval' ? 'لغو درخواست' : 'لغو نوبت' }}
        </BaseButton>

        <!-- Same eligible statuses as the cancel button above (CANCELLABLE_STATUSES mirrors
             the API's own SLOT_BLOCKING_STATUSES) -- anything that can still be cancelled can
             also be moved instead. -->
        <BaseButton
          v-if="CANCELLABLE_STATUSES.includes(booking.status)"
          variant="secondary"
          data-testid="reschedule-booking-button"
          @click="openRescheduleDialog(booking)"
        >
          تغییر زمان نوبت
        </BaseButton>

        <template v-if="booking.status === 'completed'">
          <!-- A review already on file stays viewable/editable even with the flag off,
               only net-new "ثبت نظر" is hidden -- same reasoning as bookings/[id].vue. -->
          <BaseButton
            v-if="reviewFor(booking.id)?.status !== 'withdrawn' && (reviewFor(booking.id) || featureFlags.reviewsEnabled)"
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
          class="ms-auto inline-flex items-center gap-1 text-(--color-accent-text) hover:underline"
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

    <!-- items-start + my-auto + overflow-y-auto, same reasoning as ReportForm/
         ReviewPromptModal: a long salon+service line plus the refund-outcome sentence can
         push this past a landscape phone's ~360px, and centering an overflowing flex item
         puts its top out of scroll reach. Auto cross-axis margins center when there's room
         and collapse to zero when there isn't. -->
    <div v-if="cancelTarget" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4">
      <div
        ref="cancelDialogRoot"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="cancelTitleId"
        tabindex="-1"
        data-testid="cancel-confirm-dialog"
        class="my-auto w-full max-w-sm space-y-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-6 shadow-(--shadow-lg) outline-none"
      >
        <h2 :id="cancelTitleId" class="text-lg font-bold text-(--color-text)">{{ cancelActionLabel }}</h2>
        <p class="text-sm break-words text-(--color-text)">{{ cancelTarget.salonName }} — {{ cancelTarget.serviceName }}</p>
        <p data-testid="cancel-confirm-refund-copy" class="text-sm text-(--color-text-muted)">
          {{ cancelOutcomeText(cancelTarget) }}
        </p>
        <div class="flex gap-2 pt-1">
          <BaseButton variant="secondary" block data-testid="cancel-confirm-dismiss" :disabled="cancelling" @click="closeCancelConfirm">
            انصراف
          </BaseButton>
          <BaseButton variant="danger" block data-testid="cancel-confirm-submit" :loading="cancelling" @click="confirmCancel">
            {{ cancelActionLabel }}
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Same overlay shape as the cancel dialog above, just wider (max-w-md, not max-w-sm) --
         SlotPicker's own date pills/time grid need more room than a one-line confirmation. -->
    <div v-if="rescheduleTarget" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4">
      <div
        ref="rescheduleDialogRoot"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="rescheduleTitleId"
        tabindex="-1"
        data-testid="reschedule-dialog"
        class="my-auto w-full max-w-md space-y-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-6 shadow-(--shadow-lg) outline-none"
      >
        <h2 :id="rescheduleTitleId" class="text-lg font-bold text-(--color-text)">تغییر زمان نوبت</h2>
        <p class="text-sm break-words text-(--color-text)">{{ rescheduleTarget.salonName }} — {{ rescheduleTarget.serviceName }}</p>
        <!-- The booking's own current time, stated plainly before the picker so it's clear
             what's actually being changed. -->
        <p data-testid="reschedule-current-time" class="text-sm text-(--color-text-muted)">
          زمان فعلی: {{ new Date(rescheduleTarget.startsAt).toLocaleString('fa-IR') }}
        </p>
        <SlotPicker
          :salon-id="rescheduleTarget.salonId"
          :service-id="rescheduleTarget.serviceId"
          :worker-id="rescheduleTarget.workerId"
          :selected-slot="newSlot"
          @select="newSlot = $event"
        />
        <div class="flex gap-2 pt-1">
          <BaseButton variant="secondary" block data-testid="reschedule-dismiss" :disabled="rescheduling" @click="closeRescheduleDialog">
            انصراف
          </BaseButton>
          <BaseButton
            block
            data-testid="reschedule-submit"
            :disabled="!newSlot"
            :loading="rescheduling"
            @click="confirmReschedule"
          >
            ثبت زمان جدید
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
