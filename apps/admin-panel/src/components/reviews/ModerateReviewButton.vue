<!-- apps/admin-panel/src/components/reviews/ModerateReviewButton.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppButton from '@/components/ui/AppButton.vue'

// 'withdrawn' = the customer soft-deleted their own review (DELETE /api/reviews/:id) --
// distinct from an admin 'rejected' moderation call. It is NOT a third moderation
// state an admin cycles through: see the withdrawn branch below, and
// ReviewsService.moderate() (apps/api/src/reviews/reviews.service.ts) which 409s if
// this component's guard is ever bypassed.
const props = defineProps<{ reviewId: string; status: 'published' | 'rejected' | 'withdrawn' }>()
const emit = defineEmits<{ updated: [review: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const submitting = ref(false)
const confirming = ref(false)

async function toggle() {
  submitting.value = true
  const target = props.status === 'published' ? 'rejected' : 'published'
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/reviews/${props.reviewId}`, {
    method: 'PATCH',
    body: { status: target },
  })
  submitting.value = false
  confirming.value = false
  if (data) emit('updated', data)
}
</script>

<template>
  <!-- P0 fix: a withdrawn review is the customer's own deletion, not an admin
       rejection to reverse. No "republish"/"reject" control is offered for it at
       all -- un-deleting someone else's deletion is not a routine moderation action,
       so there is nothing here to make "distinctly worded" safe to click; the backend
       has no path back from 'withdrawn' either (see reviews.service.ts). -->
  <p v-if="status === 'withdrawn'" data-testid="withdrawn-notice" class="text-sm text-(--color-text-muted)">
    این نظر توسط کاربر حذف شده و قابل تعدیل توسط مدیر نیست.
  </p>

  <div v-else-if="!confirming" class="flex flex-wrap gap-2.5">
    <AppButton
      v-if="status === 'published'"
      data-testid="reject-review"
      type="button"
      variant="danger"
      :disabled="submitting"
      @click="confirming = true"
    >
      <template #icon><AppIcon name="x" :size="15" /></template>
      رد نظر
    </AppButton>
    <AppButton
      v-else
      data-testid="republish-review"
      type="button"
      variant="secondary"
      :disabled="submitting"
      @click="confirming = true"
    >
      <template #icon><AppIcon name="check" :size="15" /></template>
      انتشار مجدد
    </AppButton>
  </div>

  <div v-else class="flex flex-wrap items-center gap-2.5 text-sm">
    <span class="text-(--color-text)">
      {{ status === 'published' ? 'این نظر رد شود؟' : 'این نظر دوباره منتشر شود؟' }}
    </span>
    <AppButton
      :data-testid="status === 'published' ? 'reject-review-confirm' : 'republish-review-confirm'"
      type="button"
      :variant="status === 'published' ? 'danger' : 'secondary'"
      :disabled="submitting"
      @click="toggle"
    >
      {{ status === 'published' ? 'رد نظر' : 'انتشار مجدد' }}
    </AppButton>
    <AppButton
      :data-testid="status === 'published' ? 'reject-review-cancel' : 'republish-review-cancel'"
      type="button"
      variant="secondary"
      :disabled="submitting"
      @click="confirming = false"
    >
      انصراف
    </AppButton>
  </div>
</template>
