<script setup lang="ts">
// Cancel confirmation shared by the bookings list and the booking detail page. It exists so
// both say the SAME money-relevant thing before the customer commits: what happens to their
// deposit (refunded in full / forfeited / nothing was ever charged). The detail page used to
// ask only «این نوبت لغو شود؟» with no refund explanation.
//
// A pending_approval request never had a Payment row, and a pending_payment booking never had
// a captured one (BookingsService.cancel), so cancelling either is free regardless of the
// window; a confirmed booking's deposit is only refunded while the cancellation window
// (/platform-config/booking-terms) hasn't closed.
const props = defineProps<{
  salonName: string
  serviceName: string
  status: 'pending_approval' | 'pending_payment' | 'confirmed' | string
  startsAt: string
  /** Whether real money was captured online for this booking (server-derived). */
  depositPaid: boolean
  /** null when /platform-config/booking-terms didn't load -- the copy then falls back to the seeded policy. */
  terms: { cancellationWindowHours: number } | null
  cancelling?: boolean
}>()
const emit = defineEmits<{ confirm: []; close: [] }>()

const outcomeText = computed(() => {
  // A manual-approval request that hasn't been answered yet never opened a payment window,
  // so there is nothing to refund and no cancellation window to be inside or outside of.
  if (props.status === 'pending_approval') {
    return 'این درخواست هنوز تایید نشده و مبلغی از شما دریافت نشده است؛ لغو آن هزینه‌ای ندارد.'
  }
  if (props.status === 'pending_payment') {
    return 'این نوبت هنوز پرداخت نشده است؛ لغو آن هزینه‌ای برای شما ندارد.'
  }
  // A confirmed booking with no payment behind it (online payment collection was off when
  // it was made): promising the deposit "will be refunded in full" would describe money that
  // never moved.
  if (!props.depositPaid) {
    return 'برای این نوبت بیعانه‌ای دریافت نشده است؛ لغو آن هزینه‌ای برای شما ندارد.'
  }
  if (!props.terms) {
    // Fallback if /platform-config/booking-terms didn't load. 24 matches the seeded
    // cancellation_window_hours (initial-schema migration), so a config fetch failure can't
    // quietly promise a longer free-cancel window than the API enforces.
    return 'لغو رایگان تا ۲۴ ساعت قبل از نوبت، پس از آن بیعانه قابل بازگشت نیست.'
  }
  const hoursUntilStart = (new Date(props.startsAt).getTime() - Date.now()) / (1000 * 60 * 60)
  const windowHours = props.terms.cancellationWindowHours.toLocaleString('fa-IR')
  if (hoursUntilStart >= props.terms.cancellationWindowHours) {
    return `چون بیش از ${windowHours} ساعت به این نوبت مانده، بیعانه شما به طور کامل بازگردانده می‌شود.`
  }
  return `چون کمتر از ${windowHours} ساعت به این نوبت مانده، بیعانه قابل بازگشت نیست.`
})

// Same wording as the triggering button, so the dialog is unmistakably about the thing the
// customer pressed (withdrawing a request vs cancelling an appointment).
const actionLabel = computed(() => (props.status === 'pending_approval' ? 'لغو درخواست' : 'لغو نوبت'))
</script>

<template>
  <ConfirmDialog
    data-testid="cancel-confirm-dialog"
    :title="actionLabel"
    :confirm-label="actionLabel"
    cancel-label="انصراف"
    tone="danger"
    :loading="cancelling"
    confirm-test-id="cancel-confirm-submit"
    cancel-test-id="cancel-confirm-dismiss"
    @confirm="emit('confirm')"
    @cancel="emit('close')"
  >
    <p class="break-words text-(--color-text)">{{ salonName }} — {{ serviceName }}</p>
    <p data-testid="cancel-confirm-refund-copy">{{ outcomeText }}</p>
  </ConfirmDialog>
</template>
