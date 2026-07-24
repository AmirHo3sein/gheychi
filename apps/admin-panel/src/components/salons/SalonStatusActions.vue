<!-- apps/admin-panel/src/components/salons/SalonStatusActions.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppButton from '@/components/ui/AppButton.vue'

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
      <AppButton
        v-if="status === 'pending'"
        data-testid="approve-button"
        type="button"
        variant="primary"
        :disabled="submitting"
        @click="approve"
      >
        <template #icon><AppIcon name="check" :size="16" /></template>
        تایید آرایشگاه
      </AppButton>
      <AppButton
        v-if="status === 'pending'"
        data-testid="reject-button"
        type="button"
        variant="danger"
        :disabled="submitting"
        @click="openReason('rejected')"
      >
        <template #icon><AppIcon name="x" :size="16" /></template>
        رد درخواست
      </AppButton>
      <AppButton
        v-if="status === 'approved'"
        data-testid="suspend-button"
        type="button"
        variant="danger"
        :disabled="submitting"
        @click="openReason('suspended')"
      >
        <template #icon><AppIcon name="warning" :size="16" /></template>
        تعلیق آرایشگاه
      </AppButton>
      <AppButton
        v-if="status === 'suspended'"
        data-testid="reapprove-button"
        type="button"
        variant="primary"
        :disabled="submitting"
        @click="approve"
      >
        <template #icon><AppIcon name="check" :size="16" /></template>
        رفع تعلیق و تایید مجدد
      </AppButton>
      <p v-if="status === 'rejected'" class="text-sm text-(--color-text-muted)">
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
        <AppButton
          data-testid="reject-submit"
          type="button"
          variant="danger"
          :disabled="submitting"
          @click="submitReason"
        >
          ثبت نهایی
        </AppButton>
        <AppButton
          type="button"
          variant="secondary"
          :disabled="submitting"
          @click="showReasonFor = null"
        >
          انصراف
        </AppButton>
      </div>
    </div>
  </div>
</template>
