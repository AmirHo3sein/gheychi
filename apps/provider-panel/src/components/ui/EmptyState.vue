<script setup lang="ts">
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'

/**
 * The mascot poses shipped in public/mascot/. Each is a ~210px tile cut on --color-mascot-tile,
 * so it is shown at 72px (well under 1x of its 2x-density size) inside a container of exactly
 * that color, which makes the tile edge disappear in both themes.
 */
export type MascotPose = 'hello' | 'happy' | 'excited' | 'thinking' | 'curious' | 'wink' | 'calendar' | 'phone' | 'done'

withDefaults(
  defineProps<{
    icon?: IconName
    message: string
    /** Optional bold line above the message. */
    title?: string
    /**
     * Swap the icon disc for a small mascot tile. Reserved for "nothing here yet" milestones on
     * a screen's main list -- not for errors, filtered-to-nothing results or secondary lists.
     */
    mascot?: MascotPose
    /** One short row instead of a centred block -- for secondary lists on a busy screen. */
    compact?: boolean
  }>(),
  { icon: 'store', title: undefined, mascot: undefined, compact: false },
)
</script>

<template>
  <div
    class="flex items-center rounded-2xl border border-dashed border-(--color-border)"
    :class="compact ? 'gap-3 px-4 py-4 text-start' : 'flex-col justify-center gap-3 px-4 py-10 text-center'"
  >
    <!-- Decorative: the message beside it says everything. -->
    <div v-if="mascot" data-testid="empty-state-mascot" class="h-18 w-18 shrink-0 overflow-hidden rounded-2xl bg-(--color-mascot-tile)" aria-hidden="true">
      <img :src="`/mascot/${mascot}.webp`" alt="" width="72" height="72" loading="lazy" decoding="async" class="h-full w-full object-contain" />
    </div>
    <div
      v-else
      class="flex shrink-0 items-center justify-center rounded-full bg-(--color-surface-subtle) text-(--color-text-muted)"
      :class="compact ? 'h-9 w-9' : 'h-12 w-12'"
    >
      <AppIcon :name="icon" :size="compact ? 18 : 22" />
    </div>
    <div class="min-w-0 max-w-sm space-y-1">
      <p v-if="title" class="text-sm font-bold text-(--color-text)">{{ title }}</p>
      <p class="text-sm leading-6 text-(--color-text-muted)">{{ message }}</p>
    </div>
    <slot />
  </div>
</template>
