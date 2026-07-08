<!-- apps/admin-panel/src/components/reviews/ModerateReviewButton.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'

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
    class="rounded-lg border border-red-600 px-3 py-1 text-sm text-red-600 disabled:opacity-40"
    @click="toggle"
  >
    رد نظر
  </button>
  <button
    v-else
    data-testid="republish-review"
    type="button"
    :disabled="submitting"
    class="rounded-lg bg-(--color-accent) px-3 py-1 text-sm text-white disabled:opacity-40"
    @click="toggle"
  >
    انتشار مجدد
  </button>
</template>
