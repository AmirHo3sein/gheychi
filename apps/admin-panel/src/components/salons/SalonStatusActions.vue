<!-- apps/admin-panel/src/components/salons/SalonStatusActions.vue -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{
  salonId: string
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  // Why the salon is suspended. 'owner_suspended' means the cascade from a suspended owner
  // account put it here, and the backend 409s any approve while that owner is still
  // suspended -- so the reapprove control is disabled rather than offered and rejected.
  suspendedCause?: 'admin' | 'owner_suspended' | null
}>()

const blockedByOwnerSuspension = computed(
  () => props.status === 'suspended' && props.suspendedCause === 'owner_suspended',
)

const emit = defineEmits<{ updated: [salon: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const showReasonFor = ref<'rejected' | 'suspended' | null>(null)
// approve/reapprove make a salon publicly live -- the Uniform Consequence Rule requires
// the same confirm-before-commit step reject/suspend already have, just without a reason
// field (approving doesn't need one). Mirrors ModerateReviewButton.vue's confirm strip.
const confirmingApprove = ref(false)
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
  confirmingApprove.value = false
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
    <div v-if="!showReasonFor && !confirmingApprove" class="flex flex-wrap gap-2.5">
      <AppButton
        v-if="status === 'pending'"
        data-testid="approve-button"
        type="button"
        variant="primary"
        :disabled="submitting"
        :loading="submitting"
        @click="confirmingApprove = true"
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
        :loading="submitting"
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
        :loading="submitting"
        @click="openReason('suspended')"
      >
        <template #icon><AppIcon name="warning" :size="16" /></template>
        تعلیق آرایشگاه
      </AppButton>
      <div v-if="status === 'suspended'" class="space-y-2">
        <AppButton
          data-testid="reapprove-button"
          type="button"
          variant="primary"
          :disabled="submitting || blockedByOwnerSuspension"
          :loading="submitting"
          @click="confirmingApprove = true"
        >
          <template #icon><AppIcon name="check" :size="16" /></template>
          رفع تعلیق و تایید مجدد
        </AppButton>
        <p v-if="blockedByOwnerSuspension" data-testid="reapprove-blocked-hint" class="text-sm text-(--color-text-muted)">
          تا زمانی که حساب مالک معلق است، تایید این آرایشگاه ممکن نیست. ابتدا از صفحهٔ کاربران، تعلیق حساب مالک را
          بردارید؛ آرایشگاه به‌صورت خودکار به حالت تایید بازمی‌گردد.
        </p>
      </div>
      <p v-if="status === 'rejected'" class="text-sm text-(--color-text-muted)">
        اقدامی برای این وضعیت لازم نیست.
      </p>
    </div>

    <div v-else-if="confirmingApprove" class="flex flex-wrap items-center gap-2.5 text-sm">
      <span class="text-(--color-text)">
        {{ status === 'suspended' ? 'رفع تعلیق و تایید مجدد این آرایشگاه انجام شود؟ پس از تایید، آرایشگاه بلافاصله در دسترس عموم قرار می‌گیرد.' : 'این آرایشگاه تایید شود؟ پس از تایید، بلافاصله در دسترس عموم قرار می‌گیرد.' }}
      </span>
      <AppButton
        :data-testid="status === 'suspended' ? 'reapprove-confirm' : 'approve-confirm'"
        type="button"
        variant="primary"
        :disabled="submitting"
        :loading="submitting"
        @click="approve"
      >
        {{ status === 'suspended' ? 'رفع تعلیق و تایید مجدد' : 'تایید آرایشگاه' }}
      </AppButton>
      <AppButton
        :data-testid="status === 'suspended' ? 'reapprove-cancel' : 'approve-cancel'"
        type="button"
        variant="secondary"
        :disabled="submitting"
        :loading="submitting"
        @click="confirmingApprove = false"
      >
        انصراف
      </AppButton>
    </div>

    <div v-else class="space-y-3">
      <label class="block text-sm font-semibold text-(--color-text)">
        دلیل {{ showReasonFor === 'rejected' ? 'رد درخواست' : 'تعلیق' }}
      </label>
      <!-- Border bumped from the app-wide --color-border (1.21:1 against white, functionally
           invisible as a field boundary) to --color-text-muted for this reason field
           specifically. The same weak border is used app-wide (AppInput.vue and every other
           reason textarea) -- reconciling that is a shared-token change out of this
           component's scope, tracked as a follow-up rather than done here piecemeal. -->
      <textarea
        v-model="reason"
        data-testid="reason-input"
        placeholder="برای اطلاع آرایشگاه‌دار، دلیل را واضح بنویسید…"
        rows="3"
        class="w-full rounded-xl border border-(--color-text-muted) p-3 text-sm"
      />
      <p v-if="reasonError" data-testid="reason-error" class="text-sm text-(--tone-danger-text)">وارد کردن دلیل الزامی است.</p>
      <div class="flex gap-2.5">
        <AppButton
          data-testid="reject-submit"
          type="button"
          variant="danger"
          :disabled="submitting"
          :loading="submitting"
          @click="submitReason"
        >
          ثبت نهایی
        </AppButton>
        <AppButton
          type="button"
          variant="secondary"
          :disabled="submitting"
          :loading="submitting"
          @click="showReasonFor = null"
        >
          انصراف
        </AppButton>
      </div>
    </div>
  </div>
</template>
