<!-- apps/admin-panel/src/components/salons/ShowcaseStatusActions.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppButton from '@/components/ui/AppButton.vue'

// Remove/restore toggle for one showcase row (story or portfolio item). Never a hard
// delete -- moderation stays reversible and the row is retained as evidence; the
// backend routes are id-addressed under /admin/stories|portfolio, not salon-scoped.
const props = defineProps<{
  kind: 'stories' | 'portfolio'
  itemId: string
  status: 'published' | 'removed'
}>()

const emit = defineEmits<{
  updated: [item: { id: string; status: string }]
  /** The PATCH failed (e.g. a 409 lost race) -- the parent should reload so the row
      reflects the winning admin's state instead of a stale, retry-doomed toggle. */
  refresh: []
}>()

const { apiFetch } = useApi()
const showReason = ref(false)
// restore() makes a story/portfolio item publicly visible again -- the Uniform
// Consequence Rule requires the same confirm-before-commit step remove() already has,
// just without a reason field. Mirrors ModerateReviewButton.vue's confirm strip.
const confirmingRestore = ref(false)
const reason = ref('')
const submitting = ref(false)

function openReason() {
  showReason.value = true
  reason.value = ''
}

function openRestoreConfirm() {
  confirmingRestore.value = true
}

function collapse() {
  showReason.value = false
  confirmingRestore.value = false
  reason.value = ''
}

async function setStatus(status: 'published' | 'removed') {
  if (submitting.value) return
  submitting.value = true
  // The reason has no column on the content row -- it lands in the audit_log payload,
  // so it's optional here just like the resolve note on reports.
  const body: { status: 'published' | 'removed'; reason?: string } = { status }
  if (status === 'removed' && reason.value.trim()) body.reason = reason.value.trim()
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/${props.kind}/${props.itemId}/status`, {
    method: 'PATCH',
    body,
  })
  submitting.value = false
  // Collapse either way: on success the toggle flipped; on failure the useApi toast has
  // already said what happened (e.g. another admin got there first), and keeping the
  // stale reason text open would just invite a doomed retry.
  collapse()
  if (data) {
    emit('updated', data)
  } else {
    emit('refresh')
  }
}
</script>

<template>
  <div>
    <div v-if="!showReason && !confirmingRestore" class="flex flex-wrap gap-2.5">
      <AppButton
        v-if="status === 'published'"
        data-testid="remove-button"
        type="button"
        variant="danger"
        :disabled="submitting"
        :loading="submitting"
        @click="openReason"
      >
        <template #icon><AppIcon name="x" :size="16" /></template>
        حذف
      </AppButton>
      <AppButton
        v-else
        data-testid="restore-button"
        type="button"
        variant="primary"
        :disabled="submitting"
        :loading="submitting"
        @click="openRestoreConfirm"
      >
        <template #icon><AppIcon name="reset" :size="16" /></template>
        بازگردانی
      </AppButton>
    </div>

    <div v-else-if="confirmingRestore" class="flex flex-wrap items-center gap-2.5 text-sm">
      <span class="text-(--color-text)">این مورد بازگردانی و دوباره در دسترس عموم قرار داده شود؟</span>
      <AppButton
        data-testid="restore-confirm"
        type="button"
        variant="primary"
        :disabled="submitting"
        :loading="submitting"
        @click="setStatus('published')"
      >
        بازگردانی
      </AppButton>
      <AppButton
        data-testid="restore-cancel"
        type="button"
        variant="secondary"
        :disabled="submitting"
        :loading="submitting"
        @click="confirmingRestore = false"
      >
        انصراف
      </AppButton>
    </div>

    <div v-else class="space-y-3">
      <label class="block text-sm font-semibold text-(--color-text)">دلیل حذف (اختیاری)</label>
      <!-- maxlength mirrors the backend DTO's @MaxLength(500) on reason. Border bumped
           from the app-wide --color-border (functionally invisible as a field boundary,
           1.21:1 against white) to --color-text-muted for this reason field specifically --
           see SalonStatusActions.vue's identical note; the same fix should eventually land
           as a shared token/AppTextarea change rather than being repeated per-component. -->
      <textarea
        v-model="reason"
        data-testid="remove-reason-input"
        placeholder="برای سابقه رسیدگی، دلیل حذف را بنویسید…"
        rows="2"
        maxlength="500"
        class="w-full rounded-xl border border-(--color-text-muted) p-3 text-sm"
      />
      <div class="flex gap-2.5">
        <AppButton
          data-testid="remove-submit"
          type="button"
          variant="danger"
          :disabled="submitting"
          :loading="submitting"
          @click="setStatus('removed')"
        >
          ثبت نهایی
        </AppButton>
        <AppButton
          data-testid="remove-cancel"
          type="button"
          variant="secondary"
          :disabled="submitting"
          :loading="submitting"
          @click="collapse"
        >
          انصراف
        </AppButton>
      </div>
    </div>
  </div>
</template>
