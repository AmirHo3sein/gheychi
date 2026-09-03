<!-- apps/provider-panel/src/components/booking/RescheduleForm.vue -->
<!-- Inline date+time picker for BookingsView's reschedule action. Extracted into its own
     component rather than tripled inline: the same JalaliDatePicker + <input type="time">
     pair the manual-booking form on that same page already uses (see BookingsView's
     submitManualBooking) is needed in THREE different booking-card contexts there -- the
     pending-approval queue, a confirmed agenda card, and a pending_payment agenda card.
     This component owns only the two wall-clock inputs and their conversion into the ISO
     instant POST /salons/mine/bookings/:id/reschedule expects; BookingsView.vue still owns
     the actual submit call, the submittingId single-flight guard (which also pauses this
     page's own background poll -- see refreshBlocked), and the post-submit refetch. -->
<script setup lang="ts">
import { ref } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'
import { tehranDateString } from '@/utils/tehran-date'

const props = defineProps<{ currentStartsAt: string; submitting: boolean }>()
const emit = defineEmits<{ submit: [startsAtIso: string]; cancel: [] }>()

// en-GB + hourCycle:'h23' formats as plain "HH:MM" (24h, Arabic digits), exactly the value
// shape a native <input type="time"> expects -- same Asia/Tehran pinning as BookingsView's
// own formatBookingTime, so a provider viewing from another timezone still edits the time
// the booking is ACTUALLY at, not whatever their browser's local clock would show.
function tehranTimeString(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Tehran' }).format(
    new Date(iso),
  )
}

// Prefilled to the booking's OWN current slot rather than left blank/defaulted to today --
// most reschedules nudge a booking by an hour or a day, not to a wholly different date, so
// starting from "where it already is" is fewer taps than starting from empty.
const date = ref(tehranDateString(new Date(props.currentStartsAt)))
const time = ref(tehranTimeString(props.currentStartsAt))
const error = ref('')

function submit() {
  if (!date.value || !time.value) {
    error.value = 'تاریخ و ساعت جدید الزامی است'
    return
  }
  error.value = ''
  // Iran's UTC offset is fixed at +03:30 (no DST since 2022) -- the exact same wall-clock ->
  // instant conversion submitManualBooking uses for the same date+time input pair. The API
  // is still the real authority on whether this instant is actually available; a rejected
  // submit surfaces through BookingsView's normal apiFetch-toast path.
  emit('submit', new Date(`${date.value}T${time.value}:00+03:30`).toISOString())
}
</script>

<template>
  <div class="space-y-2">
    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">تاریخ جدید</label>
        <JalaliDatePicker v-model="date" aria-label="تاریخ جدید نوبت" data-testid="reschedule-date" />
      </div>
      <div>
        <label class="mb-1.5 block text-xs font-semibold text-(--color-text-muted)">ساعت جدید</label>
        <input
          v-model="time"
          type="time"
          aria-label="ساعت جدید نوبت"
          data-testid="reschedule-time"
          class="tnum min-h-11 w-full min-w-0 rounded-xl border border-(--color-border) bg-(--color-surface-card) p-2 text-sm"
        />
      </div>
    </div>
    <p v-if="error" data-testid="reschedule-error" class="text-xs text-(--tone-danger-text)">{{ error }}</p>
    <div class="flex flex-wrap justify-end gap-2">
      <AppButton
        data-testid="reschedule-submit"
        type="button"
        variant="primary"
        size="sm"
        :disabled="submitting"
        :loading="submitting"
        @click="submit"
      >
        ثبت زمان جدید
      </AppButton>
      <AppButton
        data-testid="reschedule-form-cancel"
        type="button"
        variant="secondary"
        size="sm"
        :disabled="submitting"
        @click="emit('cancel')"
      >
        انصراف
      </AppButton>
    </div>
  </div>
</template>
