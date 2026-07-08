<!-- apps/admin-panel/src/components/reviews/ModerateReviewButton.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ reviewId: string; status: 'published' | 'rejected' }>()
const emit = defineEmits<{ updated: [review: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const submitting = ref(false)

async function toggle() {
  submitting.value = true
  const target = props.status === 'published' ? 'rejected' : 'published'
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/reviews/${props.reviewId}`, {
    method: 'PATCH',
    body: { status: target },
  })
  submitting.value = false
  if (data) emit('updated', data)
}
</script>

<template>
  <button
    v-if="status === 'published'"
    data-testid="reject-review"
    type="button"
    :disabled="submitting"
    class="inline-flex items-center gap-2 rounded-lg border border-(--tone-danger-text) px-3.5 py-2 text-sm font-semibold text-(--tone-danger-text) transition-colors hover:bg-(--tone-danger-bg) disabled:opacity-40"
    @click="toggle"
  >
    <AppIcon name="x" :size="15" />
    رد نظر
  </button>
  <button
    v-else
    data-testid="republish-review"
    type="button"
    :disabled="submitting"
    class="inline-flex items-center gap-2 rounded-lg bg-(--color-accent) px-3.5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
    @click="toggle"
  >
    <AppIcon name="check" :size="15" />
    انتشار مجدد
  </button>
</template>
