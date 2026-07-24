<!-- apps/admin-panel/src/components/reviews/ModerateReviewButton.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppButton from '@/components/ui/AppButton.vue'

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
  <AppButton
    v-if="status === 'published'"
    data-testid="reject-review"
    type="button"
    variant="danger"
    :disabled="submitting"
    @click="toggle"
  >
    <template #icon><AppIcon name="x" :size="15" /></template>
    رد نظر
  </AppButton>
  <AppButton
    v-else
    data-testid="republish-review"
    type="button"
    variant="primary"
    :disabled="submitting"
    @click="toggle"
  >
    <template #icon><AppIcon name="check" :size="15" /></template>
    انتشار مجدد
  </AppButton>
</template>
