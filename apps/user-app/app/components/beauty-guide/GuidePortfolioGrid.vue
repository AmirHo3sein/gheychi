<!-- apps/user-app/app/components/beauty-guide/GuidePortfolioGrid.vue
     "Similar work": published portfolio items from matching salons (each item carries its
     own salon, unlike the single-salon PortfolioGrid). Tapping opens that salon's page. -->
<script setup lang="ts">
import type { GuideMatches } from '../../utils/beauty-guide'

defineProps<{ items: GuideMatches['portfolio'] }>()
</script>

<template>
  <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
    <NuxtLink
      v-for="item in items"
      :key="item.id"
      :to="`/salons/${item.salonSlug}`"
      data-testid="guide-portfolio-item"
      class="group block overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-card)"
    >
      <NuxtImg
        provider="arvancloud"
        :src="item.url"
        width="300"
        height="300"
        loading="lazy"
        class="aspect-square w-full object-cover transition-transform group-hover:scale-105"
        :alt="item.caption || `نمونه کار ${item.salonName}`"
      />
      <span class="block truncate px-2 py-1.5 text-xs text-(--color-text-muted)">{{ item.salonName }}</span>
    </NuxtLink>
  </div>
</template>
