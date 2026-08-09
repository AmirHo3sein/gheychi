<script setup lang="ts">
import { formatRelativeDate } from '../../utils/relative-date'

interface ReviewItem { id: string; rating: number; comment: string | null; salonReply: string | null; createdAt: string }

defineProps<{ reviews: ReviewItem[]; canReport: boolean }>()
const emit = defineEmits<{ report: [reviewId: string] }>()

function flagReview(reviewId: string) {
  emit('report', reviewId)
}
</script>

<template>
  <section id="reviews">
    <h2 class="mb-2 flex items-center gap-1.5 text-lg font-bold text-(--color-text)">
      <BaseIcon name="star" :size="17" class="text-(--color-text-muted)" />
      نظرات
    </h2>
    <p v-if="!reviews.length" class="text-sm text-(--color-text-muted)">هنوز نظری ثبت نشده است</p>
    <ul v-else class="space-y-3">
      <li
        v-for="review in reviews"
        :key="review.id"
        class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-4 text-sm shadow-(--shadow-sm)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <!-- Discrete filled/unfilled star row, matching ReviewPromptModal.vue's own
                 rating-display convention -- a bare "4 —" number read as a raw data dump,
                 not a rating a customer would recognize as "their" star scale. -->
            <div class="flex items-center gap-0.5" :aria-label="`${review.rating.toLocaleString('fa-IR')} از ۵ ستاره`">
              <BaseIcon
                v-for="n in 5"
                :key="n"
                name="star"
                :size="14"
                :class="n <= review.rating ? 'text-(--color-accent-text)' : 'text-(--color-border)'"
                aria-hidden="true"
              />
            </div>
            <p class="mt-1 text-xs text-(--color-text-muted)">{{ formatRelativeDate(review.createdAt) }}</p>
          </div>
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
        <!-- A review comment is free-text a customer typed: it can contain a pasted URL or
             any other long unbreakable run, which without break-words overflows the card
             and then the page body (leftward, in RTL). -->
        <p v-if="review.comment" class="mt-2 break-words text-(--color-text)">{{ review.comment }}</p>
        <p class="mt-2 flex items-center gap-1 text-xs text-(--color-text-muted)">
          <BaseIcon name="check-circle" :size="12" />
          رزرو تایید شده
        </p>
        <!-- Provider-authored free text, same overflow exposure as the comment above. -->
        <p v-if="review.salonReply" class="mt-2 rounded-xl bg-(--color-surface-subtle) p-3 break-words text-(--color-text)">
          <span class="font-semibold">پاسخ سالن: </span>{{ review.salonReply }}
        </p>
      </li>
    </ul>
  </section>
</template>
