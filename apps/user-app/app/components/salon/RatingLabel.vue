<script setup lang="ts">
// "۰٫۰ (۰)" next to a star reads as a terrible rating, not as "no ratings yet" -- and a new
// salon is exactly the case where that unfairly hurts it. With no reviews we say so plainly
// («جدید») and never show a number we don't have.
const props = withDefaults(defineProps<{ average: number | string; count: number; iconSize?: number }>(), { iconSize: 14 })
const hasReviews = computed(() => props.count > 0)
</script>

<template>
  <span
    v-if="hasReviews"
    data-testid="rating-label"
    class="inline-flex items-center gap-1 whitespace-nowrap"
    :aria-label="`امتیاز ${Number(average).toLocaleString('fa-IR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} از ${count.toLocaleString('fa-IR')} نظر`"
  >
    <BaseIcon name="star" :size="iconSize" class="text-(--color-premium)" />
    <span class="font-semibold text-(--color-text)">{{ Number(average).toLocaleString('fa-IR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }}</span>
    <span class="text-(--color-text-muted)">({{ count.toLocaleString('fa-IR') }})</span>
  </span>
  <span
    v-else
    data-testid="rating-new"
    class="inline-flex items-center rounded-full bg-(--color-surface-subtle) px-2 py-0.5 text-xs font-medium whitespace-nowrap text-(--color-text-muted)"
  >
    جدید
  </span>
</template>
