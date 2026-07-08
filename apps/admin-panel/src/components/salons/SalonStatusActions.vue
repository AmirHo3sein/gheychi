<!-- apps/admin-panel/src/components/salons/SalonStatusActions.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'

const props = defineProps<{
  salonId: string
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
}>()

const emit = defineEmits<{ updated: [salon: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const showReasonFor = ref<'rejected' | 'suspended' | null>(null)
const reason = ref('')
const reasonError = ref(false)

async function approve() {
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/salons/${props.salonId}/status`, {
    method: 'PATCH',
    body: { status: 'approved' },
  })
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
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/salons/${props.salonId}/status`, {
    method: 'PATCH',
    body: { status: target, reason: reason.value.trim() },
  })
  if (data) {
    showReasonFor.value = null
    emit('updated', data)
  }
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="!showReasonFor" class="flex gap-2">
      <button
        v-if="status === 'pending'"
        data-testid="approve-button"
        type="button"
        class="rounded-lg bg-(--color-accent) px-4 py-2 text-sm text-white"
        @click="approve"
      >
        تایید
      </button>
      <button
        v-if="status === 'pending'"
        data-testid="reject-button"
        type="button"
        class="rounded-lg border border-red-600 px-4 py-2 text-sm text-red-600"
        @click="openReason('rejected')"
      >
        رد
      </button>
      <button
        v-if="status === 'approved'"
        data-testid="suspend-button"
        type="button"
        class="rounded-lg border border-red-600 px-4 py-2 text-sm text-red-600"
        @click="openReason('suspended')"
      >
        تعلیق
      </button>
    </div>

    <div v-else class="space-y-2">
      <textarea
        v-model="reason"
        data-testid="reason-input"
        placeholder="دلیل"
        class="w-full rounded-lg border p-2 text-sm"
      />
      <p v-if="reasonError" data-testid="reason-error" class="text-sm text-red-600">وارد کردن دلیل الزامی است.</p>
      <div class="flex gap-2">
        <button
          data-testid="reject-submit"
          type="button"
          class="rounded-lg bg-red-600 px-4 py-2 text-sm text-white"
          @click="submitReason"
        >
          ثبت
        </button>
        <button type="button" class="rounded-lg border px-4 py-2 text-sm" @click="showReasonFor = null">
          انصراف
        </button>
      </div>
    </div>
  </div>
</template>
