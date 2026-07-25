<!-- apps/admin-panel/src/components/reviews/ModerateWorkerRatingButton.vue -->
<!-- Mirrors ModerateReviewButton.vue's exact publish/reject toggle shape, pointed at the
     worker-rating moderation endpoint instead (PATCH /admin/worker-ratings/:id/status,
     AdminWorkerRatingsController -- a distinct resource/moderation surface from reviews,
     per the design spec's "conflate two different moderation surfaces" note). -->
<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppButton from '@/components/ui/AppButton.vue'

const props = defineProps<{ ratingId: string; status: 'published' | 'rejected' }>()
const emit = defineEmits<{ updated: [rating: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const submitting = ref(false)
const confirming = ref(false)
const confirmButtonRef = ref<InstanceType<typeof AppButton> | null>(null)

// The v-if/v-else swap below unmounts the clicked toggle button the instant `confirming`
// flips, which drops keyboard focus to <body> with no visible indicator. Move focus onto
// the newly-mounted confirm control instead, once it exists in the DOM.
async function askConfirm() {
  confirming.value = true
  await nextTick()
  confirmButtonRef.value?.$el?.focus()
}

async function toggle() {
  submitting.value = true
  const target = props.status === 'published' ? 'rejected' : 'published'
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/worker-ratings/${props.ratingId}/status`, {
    method: 'PATCH',
    body: { status: target },
  })
  submitting.value = false
  confirming.value = false
  if (data) emit('updated', data)
}
</script>

<template>
  <div v-if="!confirming" class="flex flex-wrap gap-2.5">
    <AppButton
      v-if="status === 'published'"
      data-testid="reject-worker-rating"
      type="button"
      variant="danger"
      :disabled="submitting"
      @click="askConfirm"
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
      @click="askConfirm"
    >
      <template #icon><AppIcon name="check" :size="15" /></template>
      انتشار مجدد
    </AppButton>
  </div>

  <div v-else class="flex flex-wrap items-center gap-2.5 text-sm">
    <span class="text-(--color-text)">
      {{ status === 'published' ? 'این امتیاز رد شود؟' : 'این امتیاز دوباره منتشر شود؟' }}
    </span>
    <AppButton
      ref="confirmButtonRef"
      :data-testid="status === 'published' ? 'reject-worker-rating-confirm' : 'republish-worker-rating-confirm'"
      type="button"
      :variant="status === 'published' ? 'danger' : 'primary'"
      :disabled="submitting"
      @click="toggle"
    >
      {{ status === 'published' ? 'رد امتیاز' : 'انتشار مجدد' }}
    </AppButton>
    <AppButton
      :data-testid="status === 'published' ? 'reject-worker-rating-cancel' : 'republish-worker-rating-cancel'"
      type="button"
      variant="secondary"
      :disabled="submitting"
      @click="confirming = false"
    >
      انصراف
    </AppButton>
  </div>
</template>
