<!-- apps/admin-panel/src/components/salons/ShowcaseStatusActions.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'

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
      <button
        v-if="status === 'published'"
        data-testid="remove-button"
        type="button"
        :disabled="submitting"
        class="inline-flex items-center gap-2 rounded-xl border border-(--tone-danger-text) px-4 py-2.5 text-sm font-semibold text-(--tone-danger-text) transition-colors hover:bg-(--tone-danger-bg) disabled:opacity-40"
        @click="openReason"
      >
        <AppIcon name="x" :size="16" />
        حذف
      </button>
      <button
        v-else
        data-testid="restore-button"
        type="button"
        :disabled="submitting"
        class="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        @click="setStatus('published')"
      >
        <AppIcon name="reset" :size="16" />
        بازگردانی
      </button>
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
        <button
          data-testid="remove-submit"
          type="button"
          :disabled="submitting"
          class="rounded-xl bg-(--tone-danger-text) px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          @click="setStatus('removed')"
        >
          ثبت نهایی
        </button>
        <button
          data-testid="remove-cancel"
          type="button"
          :disabled="submitting"
          class="rounded-xl border border-(--color-border) px-4 py-2.5 text-sm font-semibold text-(--color-muted) transition-colors hover:bg-(--color-border-soft)"
          @click="collapse"
        >
          انصراف
        </button>
      </div>
    </div>
  </div>
</template>
