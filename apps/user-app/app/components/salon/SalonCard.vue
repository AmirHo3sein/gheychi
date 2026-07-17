<script setup lang="ts">
import type { SearchResult } from '../../utils/types'

defineProps<{
  salon: SearchResult
}>()
</script>

<template>
  <NuxtLink :to="`/salons/${salon.slug}`" class="relative flex gap-3 rounded-xl bg-(--color-surface-card) p-3">
    <span
      v-if="salon.isFeatured"
      data-testid="ad-badge"
      class="absolute top-2 start-2 rounded-md bg-(--color-ad) px-1.5 py-0.5 text-[0.65rem] font-bold text-white"
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
      class="h-20 w-20 flex-shrink-0 rounded-lg object-cover"
      :class="salon.hasActiveStory ? 'ring-2 ring-(--color-accent)' : undefined"
      :alt="salon.name"
    />
    <div
      v-else
      data-testid="salon-thumb"
      class="h-20 w-20 flex-shrink-0 rounded-lg bg-(--color-surface)"
      :class="salon.hasActiveStory ? 'ring-2 ring-(--color-accent)' : undefined"
    />
    <div class="flex-1 text-sm">
      <h3 class="font-bold">{{ salon.name }}</h3>
      <p>⭐ {{ salon.ratingAvg.toFixed(1) }} ({{ salon.ratingCount }}) · {{ salon.distanceKm.toFixed(1) }} کیلومتر</p>
      <p v-if="salon.minPrice">از {{ salon.minPrice.toLocaleString('fa-IR') }} تومان</p>
    </div>
  </NuxtLink>
</template>
