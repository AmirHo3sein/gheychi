<!-- apps/admin-panel/src/components/referrals/CancelReferralAction.vue -->
<!-- Admin cancel action for a referral still awaiting its qualifying event (spec §4/§8:
     PATCH /admin/referrals/:id/cancel, body {reason}, only valid from
     'awaiting_qualifying_event' -- 409 otherwise). Mirrors the reason-required inline-panel
     shape already used across the app for irreversible/consequential actions
     (SalonStatusActions.vue's reject/suspend, ResolveReportActions.vue's resolve/dismiss),
     specifically the "reject" half: a mandatory, non-empty reason with a local validation
     error before the request ever fires.

     Deliberately NOT silent -- a 409 (already resolved by a racing admin/the qualifying
     event) must surface via the standard toast path so the acting admin knows the click did
     nothing, exactly per the task brief. -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{ referralId: string }>()

const emit = defineEmits<{
  /** Cancelled successfully -- caller should reflect the new status/reason locally. */
  cancelled: [referral: { id: string; status: string; cancelledReason: string | null }]
  /** The PATCH failed (e.g. a 409 lost race) -- caller should reload so the row reflects
      whatever actually happened instead of a stale, retry-doomed action. */
  refresh: []
}>()

const { apiFetch } = useApi()
const open = ref(false)
const reason = ref('')
const reasonError = ref(false)
const submitting = ref(false)

function openPanel() {
  open.value = true
  reason.value = ''
  reasonError.value = false
}

function collapse() {
  open.value = false
  reason.value = ''
  reasonError.value = false
}

async function submit() {
  if (submitting.value) return
  if (!reason.value.trim()) {
    reasonError.value = true
    return
  }
  submitting.value = true
  const { data } = await apiFetch<{ id: string; status: string; cancelledReason: string | null }>(
    `/admin/referrals/${props.referralId}/cancel`,
    { method: 'PATCH', body: { reason: reason.value.trim() } },
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
      v-if="!open"
      type="button"
      variant="danger"
      data-testid="cancel-referral-button"
      :disabled="submitting"
      @click="openPanel"
    >
      لغو معرفی
    </AppButton>

    <div v-else class="space-y-3">
      <label class="block text-sm font-semibold text-(--color-text)">دلیل لغو (الزامی)</label>
      <textarea
        v-model="reason"
        data-testid="cancel-reason-input"
        placeholder="دلیل لغو این معرفی را بنویسید…"
        rows="2"
        maxlength="1000"
        class="w-full rounded-xl border border-(--color-border) p-3 text-sm"
      />
      <p v-if="reasonError" data-testid="cancel-reason-error" class="text-sm text-(--tone-danger-text)">
        وارد کردن دلیل الزامی است.
      </p>
      <div class="flex gap-2.5">
        <AppButton
          type="button"
          variant="danger"
          data-testid="cancel-referral-submit"
          :disabled="submitting"
          @click="submit"
        >
          ثبت لغو
        </AppButton>
        <AppButton
          type="button"
          variant="secondary"
          data-testid="cancel-referral-dismiss"
          :disabled="submitting"
          @click="collapse"
        >
          انصراف
        </AppButton>
      </div>
    </div>
  </div>
</template>
