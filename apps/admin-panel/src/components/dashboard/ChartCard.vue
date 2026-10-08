<!-- apps/admin-panel/src/components/dashboard/ChartCard.vue -->
<script setup lang="ts">
import AppCard from '@/components/ui/AppCard.vue'

// One chart tile with the loading / error / empty / chart states every dashboard chart needs,
// so the four of them can't drift apart. The chart itself goes in the default slot and is
// only rendered once there is something to draw.
withDefaults(
  defineProps<{
    title: string
    subtitle: string
    loading: boolean
    error: boolean
    empty: boolean
    emptyMessage?: string
  }>(),
  { emptyMessage: 'داده‌ای برای نمایش موجود نیست.' },
)
</script>

<template>
  <AppCard>
    <p class="mb-1 text-sm font-bold text-(--color-text)">{{ title }}</p>
    <p class="mb-2 text-xs text-(--color-text-muted)">{{ subtitle }}</p>
    <!-- A pulsing placeholder the height of the chart instead of a bare spinner: the card
         keeps its final size (no layout jump when data lands). `animate-pulse` is switched off
         under prefers-reduced-motion in main.css, leaving a static block. -->
    <div v-if="loading" class="flex h-64 items-center justify-center" role="status" aria-label="در حال بارگذاری" data-testid="chart-loading">
      <div class="h-full w-full animate-pulse rounded-xl bg-(--color-border-soft)" />
    </div>
    <p v-else-if="error" class="py-16 text-center text-sm text-(--tone-danger-text)" data-testid="chart-error">بارگذاری داده‌ها با خطا مواجه شد.</p>
    <p v-else-if="empty" class="py-16 text-center text-sm text-(--color-text-muted)">{{ emptyMessage }}</p>
    <slot v-else />
  </AppCard>
</template>
