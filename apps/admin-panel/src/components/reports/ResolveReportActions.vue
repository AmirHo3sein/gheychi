<!-- apps/admin-panel/src/components/reports/ResolveReportActions.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{ reportId: string }>()

const emit = defineEmits<{
  updated: [report: { id: string; status: string }]
  /** The PATCH failed (e.g. a 409 lost race) -- the parent should reload so the row
      reflects the winning admin's state instead of a stale, retry-doomed 'open' card. */
  refresh: []
}>()

const { apiFetch } = useApi()
const showNoteFor = ref<'resolved' | 'dismissed' | null>(null)
const note = ref('')
const submitting = ref(false)

function openNote(target: 'resolved' | 'dismissed') {
  showNoteFor.value = target
  note.value = ''
}

function collapse() {
  showNoteFor.value = null
  note.value = ''
}

async function submit() {
  if (submitting.value) return
  const target = showNoteFor.value!
  submitting.value = true
  const body: { status: 'resolved' | 'dismissed'; note?: string } = { status: target }
  if (note.value.trim()) body.note = note.value.trim()
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/reports/${props.reportId}`, {
    method: 'PATCH',
    body,
  })
  submitting.value = false
  // Collapse either way: on success the card is done; on failure the useApi toast has
  // already said what happened, and keeping the stale note text open would just invite
  // a doomed retry against a report another admin already handled.
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
    <div v-if="!showNoteFor" class="flex flex-wrap gap-2.5">
      <AppButton
        data-testid="resolve-button"
        type="button"
        variant="secondary"
        :disabled="submitting"
        @click="openNote('resolved')"
      >
        <template #icon><AppIcon name="check" :size="16" /></template>
        رسیدگی شد
      </AppButton>
      <AppButton
        data-testid="dismiss-button"
        type="button"
        variant="danger"
        :disabled="submitting"
        @click="openNote('dismissed')"
      >
        <template #icon><AppIcon name="x" :size="16" /></template>
        رد گزارش
      </AppButton>
    </div>

    <div v-else class="space-y-3">
      <label class="block text-sm font-semibold text-(--color-text)">
        یادداشت {{ showNoteFor === 'resolved' ? 'رسیدگی' : 'رد گزارش' }} (اختیاری)
      </label>
      <!-- maxlength mirrors the backend DTO's @MaxLength(1000) on note. -->
      <textarea
        v-model="note"
        data-testid="note-input"
        placeholder="در صورت نیاز، توضیح تصمیم را بنویسید…"
        rows="2"
        maxlength="1000"
        class="w-full rounded-xl border border-(--color-border) p-3 text-sm [color-scheme:light_dark]"
      />
      <div class="flex flex-wrap gap-2.5">
        <AppButton
          data-testid="submit-resolution"
          type="button"
          :variant="showNoteFor === 'dismissed' ? 'danger' : 'primary'"
          :loading="submitting"
          :disabled="submitting"
          @click="submit"
        >
          ثبت نهایی
        </AppButton>
        <AppButton
          data-testid="cancel-resolution"
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
