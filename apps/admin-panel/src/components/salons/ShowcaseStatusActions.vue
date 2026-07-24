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
const reason = ref('')
const submitting = ref(false)

function openReason() {
  showReason.value = true
  reason.value = ''
}

function collapse() {
  showReason.value = false
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
    <div v-if="!showReason" class="flex flex-wrap gap-2.5">
      <AppButton
        v-if="status === 'published'"
        data-testid="remove-button"
        type="button"
        variant="danger"
        :disabled="submitting"
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
        @click="setStatus('published')"
      >
        <template #icon><AppIcon name="reset" :size="16" /></template>
        بازگردانی
      </AppButton>
    </div>

    <div v-else class="space-y-3">
      <label class="block text-sm font-semibold text-(--color-text)">دلیل حذف (اختیاری)</label>
      <!-- maxlength mirrors the backend DTO's @MaxLength(500) on reason. -->
      <textarea
        v-model="reason"
        data-testid="remove-reason-input"
        placeholder="برای سابقه رسیدگی، دلیل حذف را بنویسید…"
        rows="2"
        maxlength="500"
        class="w-full rounded-xl border border-(--color-border) p-3 text-sm"
      />
      <div class="flex gap-2.5">
        <AppButton
          data-testid="remove-submit"
          type="button"
          variant="danger"
          :disabled="submitting"
          @click="setStatus('removed')"
        >
          ثبت نهایی
        </AppButton>
        <AppButton
          data-testid="remove-cancel"
          type="button"
          variant="secondary"
          :disabled="submitting"
          @click="collapse"
        >
          انصراف
        </AppButton>
      </div>
    </div>
  </div>
</template>
