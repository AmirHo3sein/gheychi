<script setup lang="ts">
import type { SearchResult } from '../../utils/types'
import { iconForCategory } from '../../utils/category-icon'
import { formatToman } from '../../utils/format-toman'

const props = defineProps<{
  salon: SearchResult
}>()

// Caps at 2 visible badges + a "+N" overflow chip -- a salon can carry many tags (Part 1's
// multi-category support), and this 160px-wide column (see min-w-0 note below) can't fit
// more than a couple of short Persian words before wrapping the card's height unpredictably
// across a list.
const VISIBLE_CATEGORIES = 2
const visibleCategories = computed(() => props.salon.categories.slice(0, VISIBLE_CATEGORIES))
const hiddenCategoryCount = computed(() => Math.max(0, props.salon.categories.length - VISIBLE_CATEGORIES))
</script>

<template>
  <NuxtLink
    :to="`/salons/${salon.slug}`"
    class="relative flex gap-4 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-4 shadow-(--shadow-sm) transition-shadow hover:shadow-(--shadow-md)"
  >
    <span
      v-if="salon.isFeatured"
      data-testid="ad-badge"
      class="absolute top-2 start-2 rounded-full bg-(--color-ad-strong) px-2 py-0.5 text-xs font-bold text-(--color-fill-text)"
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
      class="h-20 w-20 flex-shrink-0 rounded-xl"
      :class="salon.hasActiveStory ? 'ring-2 ring-(--color-accent)' : undefined"
    >
      <SalonImagePlaceholder :icon-size="20" />
    </div>
    <!-- min-w-0: the 80px thumbnail is flex-shrink-0, so this column owns only what's left
         (~160px at 320px) and must be allowed to shrink to it rather than to its
         min-content width. break-words then covers the provider-authored name itself,
         which can be a single unbreakable token. -->
    <div class="min-w-0 flex-1 text-sm">
      <h3 class="font-bold break-words text-(--color-text)">{{ salon.name }}</h3>
      <div v-if="salon.categories.length" class="mt-1 flex flex-wrap items-center gap-1">
        <span
          v-for="cat in visibleCategories"
          :key="cat.id"
          class="inline-flex items-center gap-1 rounded-full bg-(--color-surface-subtle) px-2 py-0.5 text-xs text-(--color-text-muted)"
        >
          <BaseIcon :name="iconForCategory(cat.icon)" :size="11" />
          {{ cat.name }}
        </span>
        <span v-if="hiddenCategoryCount" class="text-xs text-(--color-text-muted)">+{{ hiddenCategoryCount.toLocaleString('fa-IR') }}</span>
      </div>
      <p class="mt-1 flex items-center gap-1 text-(--color-text-muted)">
        <BaseIcon name="star" :size="14" />
        {{ salon.ratingAvg.toLocaleString('fa-IR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }} ({{ salon.ratingCount.toLocaleString('fa-IR') }}) · {{ salon.distanceKm.toLocaleString('fa-IR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }} کیلومتر
      </p>
      <p v-if="salon.minPrice" class="mt-0.5 text-(--color-text-muted)">از <span dir="ltr" class="tnum">{{ formatToman(salon.minPrice) }}</span> تومان</p>
    </div>
  </NuxtLink>
</template>
