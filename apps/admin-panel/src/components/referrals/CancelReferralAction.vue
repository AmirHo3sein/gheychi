<!-- apps/admin-panel/src/components/referrals/CancelReferralAction.vue -->
<!-- Admin cancel action for a referral still awaiting its qualifying event (spec §4/§8:
     POST /admin/referrals/:id/cancel, body {reason}, only valid from
     'awaiting_qualifying_event' -- 409 otherwise). Mirrors the reason-required inline-panel
     shape already used across the app for irreversible/consequential actions
     (SalonStatusActions.vue's reject/suspend, ResolveReportActions.vue's resolve/dismiss),
     specifically the "reject" half: a mandatory, non-empty reason with a local validation
     error before the request ever fires.

     Deliberately NOT silent -- a 409 (already resolved by a racing admin/the qualifying
     event) must surface via the standard toast path so the acting admin knows the click did
     nothing, exactly per the task brief.

     Three-step local flow ('closed' -> 'entering-reason' -> 'confirming'), mirroring this
     session's money-moving reference pattern (ReferralSettingsView.vue, wallet/
     AdjustBalanceCard.vue's confirm-summary-before-commit shape) per the Uniform Consequence
     Rule -- the reason is typed in step 2, then restated on a review screen in step 3 before
     the request actually fires. Step 2's validation (non-empty reason) still gates the
     transition into step 3. -->
<script setup lang="ts">
import { ref, useId } from 'vue'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{ referralId: string }>()

const emit = defineEmits<{
  /** Cancelled successfully -- caller should reflect the new status/reason locally. */
  cancelled: [referral: { id: string; status: string; cancelledReason: string | null }]
  /** The request failed (e.g. a 409 lost race) -- caller should reload so the row reflects
      whatever actually happened instead of a stale, retry-doomed action. */
  refresh: []
}>()

const { apiFetch } = useApi()
type Step = 'closed' | 'entering-reason' | 'confirming'
const step = ref<Step>('closed')
const reason = ref('')
const reasonError = ref(false)
const submitting = ref(false)
const reasonInputId = useId()
const reasonErrorId = useId()

function openPanel() {
  step.value = 'entering-reason'
  reason.value = ''
  reasonError.value = false
}

function collapse() {
  step.value = 'closed'
  reason.value = ''
  reasonError.value = false
}

function proceedToConfirm() {
  if (!reason.value.trim()) {
    reasonError.value = true
    return
  }
  reasonError.value = false
  step.value = 'confirming'
}

function backToReason() {
  // Preserves the typed reason -- only the step changes.
  step.value = 'entering-reason'
}

async function confirmSubmit() {
  if (submitting.value) return
  submitting.value = true
  const { data } = await apiFetch<{ id: string; status: string; cancelledReason: string | null }>(
    `/admin/referrals/${props.referralId}/cancel`,
    { method: 'POST', body: { reason: reason.value.trim() } },
  )
  submitting.value = false
  collapse()
  if (data) {
    emit('cancelled', data)
  } else {
    emit('refresh')
  }
}
</script>

<template>
  <div>
    <AppButton
      v-if="step === 'closed'"
      type="button"
      variant="danger"
      data-testid="cancel-referral-button"
      @click="openPanel"
    >
      لغو معرفی
    </AppButton>

    <div v-else-if="step === 'entering-reason'" class="space-y-3">
      <label :for="reasonInputId" class="block text-sm font-semibold text-(--color-text)">دلیل لغو (الزامی)</label>
      <textarea
        :id="reasonInputId"
        v-model="reason"
        data-testid="cancel-reason-input"
        placeholder="دلیل لغو این معرفی را بنویسید…"
        rows="2"
        maxlength="1000"
        :aria-invalid="reasonError"
        :aria-describedby="reasonError ? reasonErrorId : undefined"
        class="w-full rounded-xl border border-(--color-border) p-3 text-sm"
      />
      <p v-if="reasonError" :id="reasonErrorId" data-testid="cancel-reason-error" class="text-sm text-(--tone-danger-text)">
        وارد کردن دلیل الزامی است.
      </p>
      <div class="flex flex-wrap gap-2.5">
        <AppButton
          type="button"
          variant="danger"
          data-testid="cancel-referral-submit"
          @click="proceedToConfirm"
        >
          بعدی
        </AppButton>
        <AppButton
          type="button"
          variant="secondary"
          data-testid="cancel-referral-dismiss"
          @click="collapse"
        >
          انصراف
        </AppButton>
      </div>
    </div>

    <div v-else class="space-y-3">
      <p data-testid="cancel-referral-confirm-summary" class="whitespace-pre-wrap text-sm text-(--color-text)">
        این معرفی لغو خواهد شد. دلیل: {{ reason.trim() }}
      </p>
      <div class="flex flex-wrap gap-2.5">
        <AppButton
          type="button"
          variant="danger"
          data-testid="cancel-referral-confirm"
          :disabled="submitting"
          @click="confirmSubmit"
        >
          تایید نهایی
        </AppButton>
        <AppButton
          type="button"
          variant="secondary"
          data-testid="cancel-referral-back"
          :disabled="submitting"
          @click="backToReason"
        >
          بازگشت
        </AppButton>
      </div>
    </div>
  </div>
</template>
