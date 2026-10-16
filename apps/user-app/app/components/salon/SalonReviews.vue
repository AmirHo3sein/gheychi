<script setup lang="ts">
import { formatRelativeDate } from '../../utils/relative-date'

interface ReviewItem { id: string; rating: number; comment: string | null; salonReply: string | null; createdAt: string }

// `total` (from the paginated API) drives «نمایش نظرات بیشتر»; omitted = everything is shown.
const props = withDefaults(defineProps<{ reviews: ReviewItem[]; canReport: boolean; total?: number; loadingMore?: boolean }>(), {
  total: undefined,
  loadingMore: false,
})
const emit = defineEmits<{ report: [reviewId: string]; 'load-more': [] }>()

const hasMore = computed(() => props.total !== undefined && props.reviews.length < props.total)

function flagReview(reviewId: string) {
  emit('report', reviewId)
}
</script>

<template>
  <section id="reviews">
    <h2 class="mb-2 flex items-center gap-1.5 text-xl font-bold text-(--color-text)">
      <BaseIcon name="star" :size="17" class="text-(--color-text-muted)" />
      نظرات
      <span v-if="total" class="text-sm font-medium text-(--color-text-muted)">({{ total.toLocaleString('fa-IR') }})</span>
    </h2>
    <EmptyState
      v-if="!reviews.length"
      data-testid="reviews-empty"
      pose="curious"
      compact
      title="هنوز نظری ثبت نشده است"
      description="نظرها را فقط مشتریانی می‌نویسند که نوبتشان در این سالن انجام شده است."
      class="rounded-2xl border border-(--color-border) bg-(--color-surface-card)"
    />
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
            <!-- Filled vs. outline, not colour alone: a stroke-colour difference between two
                 outline stars is invisible to colour-blind readers and in bright light. -->
            <div role="img" data-testid="review-stars" class="flex items-center gap-0.5" :aria-label="`${review.rating.toLocaleString('fa-IR')} از ۵ ستاره`">
              <BaseIcon
                v-for="n in 5"
                :key="n"
                name="star"
                :size="14"
                :fill="n <= review.rating ? 'currentColor' : 'none'"
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
    <div v-if="reviews.length && hasMore" class="mt-3 text-center">
      <BaseButton variant="secondary" data-testid="reviews-load-more" :loading="loadingMore" @click="emit('load-more')">
        نمایش نظرات بیشتر
      </BaseButton>
    </div>
  </section>
</template>
