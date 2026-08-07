<script setup lang="ts">
import { iconForCategory } from '../../utils/category-icon'

interface FavoriteSalonItem {
  id: string
  name: string
  slug: string
  city: string
  ratingAvg: number
  ratingCount: number
  coverPhoto: string | null
  categories: Array<{ id: number; name: string; icon: string }>
}

const { apiFetch } = useApi()

// silent: true + no separate error/retry UI, matching account/wallet.vue and
// account/referral.vue's own useAsyncData calls -- a failed fetch here just renders as
// "no salons saved yet", the same as a genuinely empty list. Losing that distinction is an
// accepted tradeoff for consistency with this app's other account/* pages, none of which
// have a retry affordance either.
const { data: favorites, pending } = await useAsyncData('favorites', async () => {
  const { data } = await apiFetch<FavoriteSalonItem[]>('/favorites', { silent: true })
  return data ?? []
})

useSeoMeta({ title: 'سالن‌های ذخیره‌شده — قیچی' })
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 space-y-6">
    <div class="flex items-center gap-2">
      <NuxtLink
        to="/profile"
        aria-label="بازگشت"
        class="flex h-8 w-8 items-center justify-center rounded-lg text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle)"
      >
        <BaseIcon name="chevron-forward" :size="20" />
      </NuxtLink>
      <h1 class="text-lg font-bold">سالن‌های ذخیره‌شده</h1>
    </div>

    <p
      v-if="!pending && !favorites?.length"
      data-testid="empty-state"
      class="py-6 text-center text-sm text-(--color-text-muted)"
    >
      هنوز سالنی ذخیره نکرده‌اید. با زدن آیکون قلب روی صفحه هر سالن، آن را اینجا نگه دارید.
    </p>

    <div v-else class="space-y-3 transition-opacity" :class="{ 'pointer-events-none opacity-60': pending }">
      <NuxtLink
        v-for="salon in favorites"
        :key="salon.id"
        :to="`/salons/${salon.slug}`"
        data-testid="favorite-salon"
        class="flex gap-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-3 shadow-(--shadow-sm) transition-shadow hover:shadow-(--shadow-md)"
      >
        <!-- data-testid on both branches (same convention as SalonCard.vue's own thumbnail)
             so a test can select the thumbnail slot without caring which one rendered. -->
        <NuxtImg
          v-if="salon.coverPhoto"
          provider="arvancloud"
          :src="salon.coverPhoto"
          width="80"
          height="80"
          loading="lazy"
          data-testid="favorite-salon-thumb"
          class="h-20 w-20 flex-shrink-0 rounded-xl object-cover"
          :alt="salon.name"
        />
        <div v-else data-testid="favorite-salon-thumb" class="h-20 w-20 flex-shrink-0 rounded-xl">
          <SalonImagePlaceholder :icon-size="18" />
        </div>
        <!-- min-w-0 + break-words: same reasoning as SalonCard.vue -- the thumbnail is
             flex-shrink-0, so this column owns only what's left and a provider-authored
             name can be a single unbreakable token. -->
        <div class="min-w-0 flex-1 text-sm">
          <h3 class="font-bold break-words text-(--color-text)">{{ salon.name }}</h3>
          <p class="mt-0.5 text-(--color-text-muted)">{{ salon.city }}</p>
          <div v-if="salon.categories.length" class="mt-1 flex flex-wrap items-center gap-1">
            <span
              v-for="cat in salon.categories.slice(0, 2)"
              :key="cat.id"
              class="inline-flex items-center gap-1 rounded-full bg-(--color-surface-subtle) px-2 py-0.5 text-xs text-(--color-text-muted)"
            >
              <BaseIcon :name="iconForCategory(cat.icon)" :size="11" />
              {{ cat.name }}
            </span>
          </div>
          <p v-if="salon.ratingCount" class="mt-1 flex items-center gap-1 text-(--color-text-muted)">
            <BaseIcon name="star" :size="14" />
            {{ salon.ratingAvg.toFixed(1) }} ({{ salon.ratingCount.toLocaleString('fa-IR') }})
          </p>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
