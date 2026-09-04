<!-- apps/user-app/app/components/salon/ReportForm.vue -->
<script setup lang="ts">
const props = defineProps<{
  salonId: string
  reviewId?: string | null
  storyId?: string | null
  portfolioItemId?: string | null
}>()
const emit = defineEmits<{ close: [] }>()

const { apiFetch } = useApi()
const { push } = useToast()

const reason = ref('')
const submitting = ref(false)

const reasonLength = computed(() => reason.value.trim().length)
const isValid = computed(() => reasonLength.value >= 5 && reasonLength.value <= 500)

const reasonId = useId()
const counterId = useId()

const title = computed(() => {
  if (props.reviewId) return 'گزارش این نظر'
  if (props.storyId) return 'گزارش این استوری'
  if (props.portfolioItemId) return 'گزارش این نمونه کار'
  return 'گزارش این سالن'
})

async function submit() {
  if (!isValid.value || submitting.value) return
  submitting.value = true
  // Exactly one of salonId/reviewId/storyId/portfolioItemId goes to the API (DTO
  // enforces it) -- a review/story/portfolio report derives its salon server-side.
  const reasonText = reason.value.trim()
  const body = props.reviewId
    ? { reviewId: props.reviewId, reason: reasonText }
    : props.storyId
      ? { storyId: props.storyId, reason: reasonText }
      : props.portfolioItemId
        ? { portfolioItemId: props.portfolioItemId, reason: reasonText }
        : { salonId: props.salonId, reason: reasonText }
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

const dialogRoot = ref<HTMLElement | null>(null)
// The cast works around a vue-tsc/vue 3.5.42 template-ref inference mismatch (see
// useDialog.ts's own signature) -- dialogRoot really is Ref<HTMLElement | null> at runtime.
const { titleId } = useDialog(dialogRoot as unknown as Ref<HTMLElement | null>, { onClose: close })
</script>

<template>
  <!-- items-start + my-auto rather than items-center, plus overflow-y-auto: this dialog is
       ~280px tall, which fits a 320x568 phone but not a phone held in landscape (~360px
       tall) once the on-screen keyboard opens for the textarea and claims most of the
       visual viewport. Centering an overflowing flex item pushes its top off-screen with
       no way to scroll back to it; a cross-axis auto margin centers identically when there
       IS room and collapses to zero when there isn't, leaving a plain scroll. -->
  <div class="fixed inset-0 bg-black/40 flex items-start justify-center overflow-y-auto overscroll-contain p-4 z-50">
    <div
      ref="dialogRoot"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      tabindex="-1"
      class="my-auto bg-(--color-surface-card) rounded-xl p-4 w-full max-w-sm space-y-3 outline-none"
    >
      <h2 :id="titleId" class="font-bold">{{ title }}</h2>
      <div>
        <label :for="reasonId" class="mb-1 block text-xs text-(--color-text-muted)">
          دلیل گزارش (حداقل ۵ کاراکتر)
        </label>
        <!-- resize-y: a textarea's default `resize: both` lets the user drag it WIDER than
             its w-full box, which on a 320px screen scrolls the whole dialog sideways.
             Vertical resizing stays available. -->
        <textarea
          :id="reasonId"
          v-model="reason"
          data-testid="report-reason-input"
          placeholder="دلیل گزارش (حداقل ۵ کاراکتر)"
          maxlength="500"
          rows="4"
          :aria-describedby="counterId"
          class="w-full resize-y rounded-lg border p-2 text-sm"
        />
      </div>
      <p :id="counterId" data-testid="report-reason-counter" aria-live="polite" class="text-xs opacity-70">
        {{ reasonLength.toLocaleString('fa-IR') }} / ۵۰۰
      </p>
      <BaseButton
        block
        data-testid="submit-report-button"
        :disabled="!isValid"
        :loading="submitting"
        @click="submit"
      >
        ثبت گزارش
      </BaseButton>
      <button type="button" data-testid="report-close-button" class="min-h-11 w-full text-sm" @click="close">بستن</button>
    </div>
  </div>
</template>
