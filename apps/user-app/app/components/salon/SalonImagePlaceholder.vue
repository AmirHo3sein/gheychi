<!-- apps/user-app/app/components/salon/SalonImagePlaceholder.vue -->
<script setup lang="ts">
import type { IconName } from '../ui/BaseIcon.vue'

// Stands in for a salon/service photo that doesn't exist. It used to be a large grey scissors
// glyph on a flat fill -- on a card grid that read as "image failed to load" rather than "this
// salon hasn't added photos yet". Now: the brand blush with a soft peach wash and a small,
// muted brand mark, so a photo-less card still looks like it belongs to قیچی without
// pretending to be a photo. The mark is decoration; the surrounding card names the salon.
// Sized from iconSize so tiny service thumbs get a tiny mark, never a giant one.
//
// StoriesRing passes `icon` ("no story cover" is a different meaning) and keeps the plain
// icon treatment, so an explicit icon still renders exactly as before.
const props = withDefaults(
  defineProps<{ rounded?: 'xl' | 'full'; iconSize?: number; icon?: IconName }>(),
  { rounded: 'xl', iconSize: 24 },
)

// ~1.25x the old icon size, capped: the mark should be a quiet signature, not a hero.
const markSize = computed(() => Math.min(56, Math.max(18, Math.round(props.iconSize * 1.25))))
</script>

<template>
  <div
    data-testid="salon-image-placeholder"
    class="flex h-full w-full items-center justify-center bg-linear-to-br from-(--color-surface-subtle) to-(--color-accent-soft) text-(--color-text-muted)"
    :class="rounded === 'full' ? 'rounded-full' : 'rounded-xl'"
  >
    <BaseIcon v-if="icon" :name="icon" :size="iconSize" class="opacity-50" />
    <!-- A CSS background, not an <img>: this is decoration, and a placeholder must never be
         mistaken (by assistive tech, by tests, by crawlers) for an actual photo. -->
    <span
      v-else
      aria-hidden="true"
      data-testid="placeholder-brand-mark"
      class="block rounded-[28%] bg-cover bg-center opacity-55 mix-blend-multiply saturate-[.8] dark:opacity-40 dark:mix-blend-normal"
      :style="{ width: `${markSize}px`, height: `${markSize}px`, backgroundImage: 'url(/brand-icon.png)' }"
    />
  </div>
</template>
