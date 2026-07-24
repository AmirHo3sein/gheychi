<!-- apps/admin-panel/src/components/reviews/ModerateWorkerRatingButton.vue -->
<!-- Mirrors ModerateReviewButton.vue's exact publish/reject toggle shape, pointed at the
     worker-rating moderation endpoint instead (PATCH /admin/worker-ratings/:id/status,
     AdminWorkerRatingsController -- a distinct resource/moderation surface from reviews,
     per the design spec's "conflate two different moderation surfaces" note). -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{ ratingId: string; status: 'published' | 'rejected' }>()
const emit = defineEmits<{ updated: [rating: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const submitting = ref(false)

async function toggle() {
  submitting.value = true
  const target = props.status === 'published' ? 'rejected' : 'published'
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/worker-ratings/${props.ratingId}/status`, {
    method: 'PATCH',
    body: { status: target },
  })
  submitting.value = false
  if (data) emit('updated', data)
}
</script>

<template>
  <AppButton
    v-if="status === 'published'"
    data-testid="reject-worker-rating"
    type="button"
    variant="danger"
    :disabled="submitting"
    @click="toggle"
  >
    <template #icon><AppIcon name="x" :size="15" /></template>
    رد امتیاز
  </AppButton>
  <AppButton
    v-else
    data-testid="republish-worker-rating"
    type="button"
    variant="primary"
    :disabled="submitting"
    @click="toggle"
  >
    <template #icon><AppIcon name="check" :size="15" /></template>
    انتشار مجدد
  </AppButton>
</template>
