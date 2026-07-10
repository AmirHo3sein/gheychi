<!-- apps/user-app/app/components/salon/ReportForm.vue -->
<script setup lang="ts">
const props = defineProps<{ salonId: string; reviewId?: string | null }>()
const emit = defineEmits<{ close: [] }>()

const { apiFetch } = useApi()
const { push } = useToast()

const reason = ref('')
const submitting = ref(false)

const reasonLength = computed(() => reason.value.trim().length)
const isValid = computed(() => reasonLength.value >= 5 && reasonLength.value <= 500)

async function submit() {
  if (!isValid.value || submitting.value) return
  submitting.value = true
  // Exactly one of salonId/reviewId goes to the API (DTO enforces it) -- a reviewId
  // report derives its salon server-side.
  const body = props.reviewId
    ? { reviewId: props.reviewId, reason: reason.value.trim() }
    : { salonId: props.salonId, reason: reason.value.trim() }
  // silent: the three known outcomes get their own Farsi toasts below; only a 401
  // still triggers useApi's redirect-to-/login (fine -- the affordance only renders
  // for logged-in users, so that means the session just expired).
  const { error } = await apiFetch('/reports', { method: 'POST', body, silent: true })
  submitting.value = false
  if (!error) {
    push('گزارش شما ثبت شد و توسط تیم پشتیبانی بررسی می‌شود')
    emit('close')
    return
  }
  if (error.status === 409) {
    push('گزارش قبلی شما هنوز در حال بررسی است')
    emit('close')
    return
  }
  if (error.status === 403) {
    push('فقط مشتریانی با نوبت تکمیل‌شده در این سالن می‌توانند گزارش ثبت کنند')
    emit('close')
    return
  }
  push('ثبت گزارش ناموفق بود؛ لطفا دوباره تلاش کنید')
}

function close() {
  emit('close')
}
</script>

<template>
  <div class="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
    <div class="bg-(--color-surface-card) rounded-xl p-4 w-full max-w-sm space-y-3">
      <h2 class="font-bold">{{ reviewId ? 'گزارش این نظر' : 'گزارش این سالن' }}</h2>
      <textarea
        v-model="reason"
        data-testid="report-reason-input"
        placeholder="دلیل گزارش (حداقل ۵ کاراکتر)"
        maxlength="500"
        rows="4"
        class="w-full rounded-lg border p-2 text-sm"
      />
      <p data-testid="report-reason-counter" class="text-xs opacity-70">
        {{ reasonLength.toLocaleString('fa-IR') }} / ۵۰۰
      </p>
      <button
        type="button"
        data-testid="submit-report-button"
        :disabled="submitting || !isValid"
        class="w-full rounded-lg bg-(--color-accent) text-white p-2 font-semibold disabled:opacity-50"
        @click="submit"
      >
        ثبت گزارش
      </button>
      <button type="button" class="w-full text-sm" @click="close">بستن</button>
    </div>
  </div>
</template>
