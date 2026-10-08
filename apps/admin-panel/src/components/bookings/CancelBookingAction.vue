<!-- apps/admin-panel/src/components/bookings/CancelBookingAction.vue -->
<!-- Platform (support) cancellation of one booking. A modal dialog rather than an inline strip:
     the action refunds money and notifies a customer, so it must interrupt, take focus, trap
     Tab, close on Escape and hand focus back to the button that opened it. -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ bookingId: string }>()
const emit = defineEmits<{
  /** The cancel went through. */
  cancelled: []
  /** The cancel failed because the booking is no longer cancellable -- the parent should reload. */
  refresh: []
}>()

// Mirrors the minimum the API accepts for a reason; trimmed so whitespace can't satisfy it.
const MIN_REASON_LENGTH = 5

const { apiFetch } = useApi()
const { push: pushToast } = useToast()

const open = ref(false)
const reason = ref('')
const touched = ref(false)
const submitting = ref(false)

const trigger = ref<InstanceType<typeof AppButton> | null>(null)
const panel = ref<HTMLElement | null>(null)
const reasonInput = ref<HTMLTextAreaElement | null>(null)
const uid = Math.random().toString(36).slice(2, 8)
const titleId = `cancel-title-${uid}`
const descId = `cancel-desc-${uid}`
const errorId = `cancel-error-${uid}`

const trimmed = computed(() => reason.value.trim())
const reasonInvalid = computed(() => trimmed.value.length < MIN_REASON_LENGTH)
const showError = computed(() => touched.value && reasonInvalid.value)

let previousOverflow = ''

async function openDialog() {
  reason.value = ''
  touched.value = false
  open.value = true
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  await nextTick()
  reasonInput.value?.focus()
}

function closeDialog() {
  if (submitting.value) return
  open.value = false
}

watch(open, async (isOpen, wasOpen) => {
  if (!isOpen && wasOpen) {
    document.body.style.overflow = previousOverflow
    await nextTick()
    ;(trigger.value?.$el as HTMLElement | undefined)?.focus()
  }
})

onBeforeUnmount(() => {
  if (open.value) document.body.style.overflow = previousOverflow
})

async function submit() {
  touched.value = true
  if (reasonInvalid.value || submitting.value) return
  submitting.value = true
  const { error } = await apiFetch(`/admin/bookings/${props.bookingId}/cancel`, {
    method: 'POST',
    body: { reason: trimmed.value },
  })
  submitting.value = false
  if (!error) {
    pushToast('نوبت لغو شد؛ مشتری مطلع می‌شود و بیعانهٔ دریافت‌شده بازگردانده می‌شود.', 'success')
    open.value = false
    emit('cancelled')
    return
  }
  // useApi already toasted the server's message. A 409 means someone else moved the booking
  // first -- the dialog would only invite a doomed retry, so close it and reload the row.
  if (error.status === 409) {
    open.value = false
    emit('refresh')
  }
}

function focusables(): HTMLElement[] {
  return Array.from(panel.value?.querySelectorAll<HTMLElement>('textarea, button:not([disabled])') ?? [])
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeDialog()
    return
  }
  if (e.key !== 'Tab') return
  const items = focusables()
  if (items.length === 0) return
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement
  if (e.shiftKey && (active === first || !panel.value?.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !panel.value?.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <AppButton ref="trigger" data-testid="cancel-booking-button" type="button" variant="ghost" @click="openDialog">
    <template #icon><AppIcon name="x" :size="14" /></template>
    لغو توسط پشتیبانی
  </AppButton>

  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" data-testid="cancel-dialog-root" @keydown="onKeydown">
      <div class="absolute inset-0 bg-black/50" data-testid="cancel-backdrop" @click="closeDialog" />
      <div
        ref="panel"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descId"
        class="relative max-h-full w-full overflow-y-auto rounded-t-2xl border border-(--color-border) bg-(--color-surface-card) p-5 shadow-(--shadow-lg) sm:max-w-md sm:rounded-2xl"
      >
        <h2 :id="titleId" class="text-base font-bold text-(--color-text)">لغو نوبت توسط پشتیبانی</h2>
        <p :id="descId" class="mt-2 text-sm leading-6 text-(--color-text-muted)">
          مشتری از لغو نوبت مطلع می‌شود، بیعانهٔ پرداخت‌شده (در صورت وجود) به‌طور کامل بازگردانده می‌شود و اعتبار کیف پول و کد تخفیف استفاده‌شده برمی‌گردد. این کار قابل بازگشت نیست.
        </p>

        <label for="cancel-reason" class="mt-4 block text-sm font-semibold text-(--color-text)">دلیل لغو (الزامی)</label>
        <textarea
          id="cancel-reason"
          ref="reasonInput"
          v-model="reason"
          data-testid="cancel-reason"
          rows="3"
          :aria-invalid="showError"
          :aria-describedby="showError ? errorId : undefined"
          placeholder="دلیل را واضح بنویسید؛ در سوابق ثبت می‌شود…"
          class="mt-1.5 w-full rounded-xl border border-(--color-text-muted) bg-(--color-surface-card) p-3 text-sm text-(--color-text)"
          @blur="touched = true"
        />
        <p v-if="showError" :id="errorId" data-testid="cancel-reason-error" role="alert" class="mt-1 text-sm text-(--tone-danger-text)">
          دلیل لغو باید دست‌کم {{ MIN_REASON_LENGTH.toLocaleString('fa-IR') }} نویسه باشد.
        </p>

        <div class="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <AppButton data-testid="cancel-submit" variant="danger" :loading="submitting" @click="submit">لغو نوبت</AppButton>
          <AppButton data-testid="cancel-dismiss" variant="secondary" :disabled="submitting" @click="closeDialog">انصراف</AppButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>
