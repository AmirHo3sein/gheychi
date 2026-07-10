<!-- apps/admin-panel/src/components/reports/ResolveReportActions.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ reportId: string }>()

const emit = defineEmits<{ updated: [report: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const showNoteFor = ref<'resolved' | 'dismissed' | null>(null)
const note = ref('')
const submitting = ref(false)

function openNote(target: 'resolved' | 'dismissed') {
  showNoteFor.value = target
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
  if (data) {
    showNoteFor.value = null
    emit('updated', data)
  }
}
</script>

<template>
  <div>
    <div v-if="!showNoteFor" class="flex flex-wrap gap-2.5">
      <button
        data-testid="resolve-button"
        type="button"
        :disabled="submitting"
        class="inline-flex items-center gap-2 rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        @click="openNote('resolved')"
      >
        <AppIcon name="check" :size="16" />
        رسیدگی شد
      </button>
      <button
        data-testid="dismiss-button"
        type="button"
        :disabled="submitting"
        class="inline-flex items-center gap-2 rounded-xl border border-(--tone-danger-text) px-4 py-2.5 text-sm font-semibold text-(--tone-danger-text) transition-colors hover:bg-(--tone-danger-bg) disabled:opacity-40"
        @click="openNote('dismissed')"
      >
        <AppIcon name="x" :size="16" />
        رد گزارش
      </button>
    </div>

    <div v-else class="space-y-3">
      <label class="block text-sm font-semibold text-(--color-text)">
        یادداشت {{ showNoteFor === 'resolved' ? 'رسیدگی' : 'رد گزارش' }} (اختیاری)
      </label>
      <textarea
        v-model="note"
        data-testid="note-input"
        placeholder="در صورت نیاز، توضیح تصمیم را بنویسید…"
        rows="2"
        class="w-full rounded-xl border border-(--color-border) p-3 text-sm"
      />
      <div class="flex gap-2.5">
        <button
          data-testid="submit-resolution"
          type="button"
          :disabled="submitting"
          class="rounded-xl bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          @click="submit"
        >
          ثبت نهایی
        </button>
        <button
          data-testid="cancel-resolution"
          type="button"
          :disabled="submitting"
          class="rounded-xl border border-(--color-border) px-4 py-2.5 text-sm font-semibold text-(--color-muted) transition-colors hover:bg-(--color-border-soft)"
          @click="showNoteFor = null"
        >
          انصراف
        </button>
      </div>
    </div>
  </div>
</template>
