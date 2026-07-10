<script setup lang="ts">
interface ReviewItem { id: string; rating: number; comment: string | null; salonReply: string | null; createdAt: string }

defineProps<{ reviews: ReviewItem[]; canReport: boolean }>()
const emit = defineEmits<{ report: [reviewId: string] }>()

function flagReview(reviewId: string) {
  emit('report', reviewId)
}
</script>

<template>
  <section>
    <h2 class="font-bold mb-2">نظرات</h2>
    <p v-if="!reviews.length" class="text-sm">هنوز نظری ثبت نشده است</p>
    <ul v-else class="space-y-3">
      <li v-for="review in reviews" :key="review.id" class="rounded-lg bg-(--color-surface-card) p-3 text-sm">
        <div class="flex items-start justify-between gap-2">
          <p>⭐ {{ review.rating }} — {{ review.comment }}</p>
          <button
            v-if="canReport"
            type="button"
            data-testid="flag-review-button"
            title="گزارش این نظر"
            class="shrink-0 text-xs opacity-60"
            @click="flagReview(review.id)"
          >
            🚩
          </button>
        </div>
        <p v-if="review.salonReply" class="mt-1 ps-3 border-s-2 text-(--color-text)">
          پاسخ سالن: {{ review.salonReply }}
        </p>
      </li>
    </ul>
  </section>
</template>
