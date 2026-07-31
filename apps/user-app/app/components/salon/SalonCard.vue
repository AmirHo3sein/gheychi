<script setup lang="ts">
import type { SearchResult } from '../../utils/types'

defineProps<{
  salon: SearchResult
}>()
</script>

<template>
  <NuxtLink
    :to="`/salons/${salon.slug}`"
    class="relative flex gap-4 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-4 shadow-(--shadow-sm) transition-shadow hover:shadow-(--shadow-md)"
  >
    <span
      v-if="salon.isFeatured"
      data-testid="ad-badge"
      class="absolute top-2 start-2 rounded-full bg-(--color-ad-strong) px-2 py-0.5 text-xs font-bold text-white"
    >
      تبلیغ
    </span>
    <!-- Thin accent ring = the salon has at least one active story (SSR-rendered cue). -->
    <NuxtImg
      v-if="salon.coverPhoto"
      provider="arvancloud"
      :src="salon.coverPhoto"
      width="80"
      height="80"
      loading="lazy"
      data-testid="salon-thumb"
      class="h-20 w-20 flex-shrink-0 rounded-xl object-cover"
      :class="salon.hasActiveStory ? 'ring-2 ring-(--color-accent)' : undefined"
      :alt="salon.name"
    />
    <div
      v-else
      data-testid="salon-thumb"
      class="h-20 w-20 flex-shrink-0 rounded-xl bg-(--color-surface)"
      :class="salon.hasActiveStory ? 'ring-2 ring-(--color-accent)' : undefined"
    />
    <!-- min-w-0: the 80px thumbnail is flex-shrink-0, so this column owns only what's left
         (~160px at 320px) and must be allowed to shrink to it rather than to its
         min-content width. break-words then covers the provider-authored name itself,
         which can be a single unbreakable token. -->
    <div class="min-w-0 flex-1 text-sm">
      <h3 class="font-bold break-words text-(--color-text)">{{ salon.name }}</h3>
      <p class="mt-1 flex items-center gap-1 text-(--color-text-muted)">
        <BaseIcon name="star" :size="14" />
        {{ salon.ratingAvg.toFixed(1) }} ({{ salon.ratingCount }}) · {{ salon.distanceKm.toFixed(1) }} کیلومتر
      </p>
      <p v-if="salon.minPrice" class="mt-0.5 text-(--color-text-muted)">از {{ salon.minPrice.toLocaleString('fa-IR') }} تومان</p>
    </div>
  </NuxtLink>
</template>
