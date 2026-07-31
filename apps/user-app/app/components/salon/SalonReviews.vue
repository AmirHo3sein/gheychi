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
      <li
        v-for="review in reviews"
        :key="review.id"
        class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 text-sm shadow-(--shadow-sm)"
      >
        <div class="flex items-start justify-between gap-2">
          <!-- A review comment is free-text a customer typed: it can contain a pasted URL
               or any other long unbreakable run, which without min-w-0 + break-words
               overflows the card and then the page body (leftward, in RTL). items-start
               also keeps the star pinned to the first line of a comment that wraps. -->
          <p class="flex min-w-0 items-start gap-1 break-words">
            <BaseIcon name="star" :size="14" class="mt-0.5" />
            {{ review.rating }} — {{ review.comment }}
          </p>
          <button
            v-if="canReport"
            type="button"
            data-testid="flag-review-button"
            title="گزارش این نظر"
            aria-label="گزارش این نظر"
            class="-me-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center text-(--color-text-muted) opacity-60"
            @click="flagReview(review.id)"
          >
            <!-- The icon stays 14px; the 44px box around it is the tap target. Negative
                 insets pull that box back into the card's corner so the padding it adds is
                 spent on reachable area rather than on visible whitespace. -->
            <BaseIcon name="flag" :size="14" />
          </button>
        </div>
        <p class="mt-1 flex items-center gap-1 text-xs text-(--color-text-muted)">
          <BaseIcon name="check-circle" :size="12" />
          رزرو تایید شده
        </p>
        <!-- Provider-authored free text, same overflow exposure as the comment above. -->
        <p v-if="review.salonReply" class="mt-1 ps-3 border-s-2 break-words text-(--color-text)">
          پاسخ سالن: {{ review.salonReply }}
        </p>
      </li>
    </ul>
  </section>
</template>
