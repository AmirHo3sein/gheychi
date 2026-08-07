<!-- apps/user-app/app/components/salon/SalonImagePlaceholder.vue -->
<script setup lang="ts">
import type { IconName } from '../ui/BaseIcon.vue'

// Icon-on-flat-background, matching StoriesRing.vue's original convention for a missing
// cover photo -- extends that rather than introducing a raster placeholder asset, which
// PRODUCT.md's budget-Android/variable-data constraint argues against. `icon` defaults to
// the brand scissors mark (Gheychi's own ✂️ identity) for the "no salon photo" case, but
// StoriesRing.vue's "no story cover" case is a distinct enough meaning to warrant its own
// icon (sparkles) while still sharing this component's sizing/background/rounding.
withDefaults(
  defineProps<{ rounded?: 'xl' | 'full'; iconSize?: number; icon?: IconName }>(),
  { rounded: 'xl', iconSize: 24, icon: 'scissors' },
)
</script>

<template>
  <div
    data-testid="salon-image-placeholder"
    class="flex h-full w-full items-center justify-center bg-(--color-surface-subtle) text-(--color-text-muted)"
    :class="rounded === 'full' ? 'rounded-full' : 'rounded-xl'"
  >
    <BaseIcon :name="icon" :size="iconSize" class="opacity-50" />
  </div>
</template>
