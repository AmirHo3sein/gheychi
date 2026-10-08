<script setup lang="ts">
import type { SearchResult } from '../../utils/types'
import { iconForCategory } from '../../utils/category-icon'
import { formatToman } from '../../utils/format-toman'

const props = defineProps<{
  salon: SearchResult
}>()

// Caps at 2 visible badges + a "+N" overflow chip -- a salon can carry many tags (Part 1's
// multi-category support) and the card is a fixed-height scanning unit in a grid, so more
// than a couple of short Persian words would make card heights unpredictable across a row.
const VISIBLE_CATEGORIES = 2
const visibleCategories = computed(() => props.salon.categories.slice(0, VISIBLE_CATEGORIES))
const hiddenCategoryCount = computed(() => Math.max(0, props.salon.categories.length - VISIBLE_CATEGORIES))
</script>

<template>
  <!-- Image-first: a salon is chosen by looking at its work, and the old 80px thumbnail made
       the photo an afterthought next to text. The photo is now an inset, rounded tile (the card
       keeps its padding around it) rather than an edge-to-edge header, which is what lets the
       story ring sit just outside the image without being clipped by the card. -->
  <NuxtLink
    :to="`/salons/${salon.slug}`"
    class="group relative block rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-2.5 shadow-(--shadow-sm) transition-[box-shadow,transform] duration-200 hover:shadow-(--shadow-md) active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
  >
    <!-- Thin accent ring = the salon has at least one active story (SSR-rendered cue). The
         offset keeps the ring clear of the image edge, inside the card's padding. -->
    <div
      data-testid="salon-thumb"
      class="relative aspect-[16/10] overflow-hidden rounded-xl bg-(--color-surface-subtle) sm:aspect-[4/3]"
      :class="salon.hasActiveStory ? 'ring-2 ring-(--color-accent) ring-offset-2 ring-offset-(--color-surface-card)' : undefined"
    >
      <SafeImage
        v-if="salon.coverPhoto"
        :src="salon.coverPhoto"
        :alt="salon.name"
        :width="480"
        :height="360"
        loading="lazy"
        class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      />
      <SalonImagePlaceholder v-else :icon-size="32" />
      <span
        v-if="salon.isFeatured"
        data-testid="ad-badge"
        class="absolute top-2 start-2 rounded-full bg-(--color-ad-strong) px-2 py-0.5 text-xs font-bold text-(--color-fill-text)"
      >
        تبلیغ
      </span>
      <span
        v-if="salon.hasActiveStory"
        class="absolute bottom-2 start-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-xs font-semibold text-white"
      >
        <BaseIcon name="play" :size="10" />
        استوری
      </span>
    </div>

    <div class="px-1.5 pt-2.5 pb-1">
      <!-- min-w-0 + break-words: the name is provider-authored and can be one long unbreakable
           token; it has to be allowed to shrink beside the rating instead of pushing it off. -->
      <div class="flex items-start justify-between gap-2">
        <h3 class="min-w-0 break-words font-bold leading-6 text-(--color-text)">{{ salon.name }}</h3>
        <RatingLabel :average="salon.ratingAvg" :count="salon.ratingCount" class="mt-0.5 shrink-0 text-sm" />
      </div>

      <p class="mt-0.5 flex items-center gap-1 text-xs text-(--color-text-muted)">
        <BaseIcon name="map-pin" :size="12" />
        <span class="min-w-0 truncate">{{ salon.city }}</span>
        <span aria-hidden="true">·</span>
        <span class="whitespace-nowrap">{{ salon.distanceKm.toLocaleString('fa-IR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }} کیلومتر</span>
      </p>

      <div v-if="salon.categories.length" class="mt-2 flex flex-wrap items-center gap-1">
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

      <p v-if="salon.minPrice" class="mt-2 text-sm text-(--color-text-muted)">
        شروع از <span class="font-bold text-(--color-text)"><span dir="ltr" class="tnum">{{ formatToman(salon.minPrice) }}</span> تومان</span>
      </p>
    </div>
  </NuxtLink>
</template>
