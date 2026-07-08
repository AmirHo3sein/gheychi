<!-- apps/admin-panel/src/components/salons/SalonStatusActions.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{
  salonId: string
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
}>()

const emit = defineEmits<{ updated: [salon: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const showReasonFor = ref<'rejected' | 'suspended' | null>(null)
const reason = ref('')
const reasonError = ref(false)
const submitting = ref(false)

async function approve() {
  submitting.value = true
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/salons/${props.salonId}/status`, {
    method: 'PATCH',
    body: { status: 'approved' },
  })
  submitting.value = false
  if (data) emit('updated', data)
}

function openReason(target: 'rejected' | 'suspended') {
  showReasonFor.value = target
  reason.value = ''
  reasonError.value = false
}

async function submitReason() {
  if (!reason.value.trim()) {
    reasonError.value = true
    return
  }
  const target = showReasonFor.value!
  submitting.value = true
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/salons/${props.salonId}/status`, {
    method: 'PATCH',
    body: { status: target, reason: reason.value.trim() },
  })
  submitting.value = false
  if (data) {
    showReasonFor.value = null
    emit('updated', data)
  }
}
</script>

<template>
  <div>
    <div v-if="!showReasonFor" class="flex flex-wrap gap-2.5">
      <button
        v-if="status === 'pending'"
        data-testid="approve-button"
        type="button"
        :disabled="submitting"
        class="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        @click="approve"
      >
        <AppIcon name="check" :size="16" />
        تایید آرایشگاه
      </button>
      <button
        v-if="status === 'pending'"
        data-testid="reject-button"
        type="button"
        :disabled="submitting"
        class="inline-flex items-center gap-2 rounded-xl border border-(--tone-danger-text) px-4 py-2.5 text-sm font-semibold text-(--tone-danger-text) transition-colors hover:bg-(--tone-danger-bg) disabled:opacity-40"
        @click="openReason('rejected')"
      >
        <AppIcon name="x" :size="16" />
        رد درخواست
      </button>
      <button
        v-if="status === 'approved'"
        data-testid="suspend-button"
        type="button"
        :disabled="submitting"
        class="inline-flex items-center gap-2 rounded-xl border border-(--tone-danger-text) px-4 py-2.5 text-sm font-semibold text-(--tone-danger-text) transition-colors hover:bg-(--tone-danger-bg) disabled:opacity-40"
        @click="openReason('suspended')"
      >
        <AppIcon name="warning" :size="16" />
        تعلیق آرایشگاه
      </button>
      <p v-if="status === 'suspended' || status === 'rejected'" class="text-sm text-(--color-muted)">
        اقدامی برای این وضعیت لازم نیست.
      </p>
    </div>

    <div v-else class="space-y-3">
      <label class="block text-sm font-semibold text-(--color-text)">
        دلیل {{ showReasonFor === 'rejected' ? 'رد درخواست' : 'تعلیق' }}
      </label>
      <textarea
        v-model="reason"
        data-testid="reason-input"
        placeholder="برای اطلاع آرایشگاه‌دار، دلیل را واضح بنویسید…"
        rows="3"
        class="w-full rounded-xl border border-(--color-border) p-3 text-sm"
      />
      <p v-if="reasonError" data-testid="reason-error" class="text-sm text-(--tone-danger-text)">وارد کردن دلیل الزامی است.</p>
      <div class="flex gap-2.5">
        <button
          data-testid="reject-submit"
          type="button"
          :disabled="submitting"
          class="rounded-xl bg-(--tone-danger-text) px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          @click="submitReason"
        >
          ثبت نهایی
        </button>
        <button
          type="button"
          :disabled="submitting"
          class="rounded-xl border border-(--color-border) px-4 py-2.5 text-sm font-semibold text-(--color-muted) transition-colors hover:bg-(--color-border-soft)"
          @click="showReasonFor = null"
        >
          انصراف
        </button>
      </div>
    </div>
  </div>
</template>
