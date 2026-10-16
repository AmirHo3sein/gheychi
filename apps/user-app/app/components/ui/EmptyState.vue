<script setup lang="ts">
// The one empty/no-result treatment for the whole app: a mascot pose tile, a short title,
// an optional line of guidance and an optional next step. It replaces the one-line muted
// sentences each list used to render on its own, which read as "something failed to load"
// more than "nothing here yet".
//
// The pose tiles in /mascot/ are cut at ~210px on exactly --color-mascot-tile, so the image
// sits inside a container of that colour with rounded corners (the tile edge then vanishes)
// and is never drawn above 112px CSS. The mascot is decoration: alt="" -- the title carries
// the meaning. Any attribute a caller passes (data-testid, role, aria-live) lands on the root.
export type MascotPose = 'hello' | 'happy' | 'excited' | 'thinking' | 'curious' | 'wink' | 'calendar' | 'phone' | 'done'

const props = withDefaults(
  defineProps<{
    pose?: MascotPose
    title: string
    description?: string
    /** Optional single next step rendered as a primary-styled link. Use the default slot for anything else. */
    actionTo?: string
    actionLabel?: string
    /** Tighter spacing and a smaller tile, for empty sections inside a larger page. */
    compact?: boolean
  }>(),
  { pose: 'happy', compact: false },
)

const tileSize = computed(() => (props.compact ? 72 : 112))
</script>

<template>
  <div
    class="flex flex-col items-center text-center"
    :class="compact ? 'gap-2 py-5' : 'gap-3 py-8'"
  >
    <span
      class="flex shrink-0 items-center justify-center overflow-hidden bg-(--color-mascot-tile)"
      :class="compact ? 'rounded-2xl' : 'rounded-3xl'"
      :style="{ width: `${tileSize}px`, height: `${tileSize}px` }"
      data-testid="empty-state-mascot"
    >
      <img
        :src="`/mascot/${pose}.webp`"
        alt=""
        :width="tileSize"
        :height="tileSize"
        loading="lazy"
        decoding="async"
        class="h-full w-full object-contain"
      />
    </span>
    <div class="max-w-sm space-y-1">
      <p class="font-bold text-(--color-text)" :class="compact ? 'text-sm' : 'text-base'" data-testid="empty-state-title">{{ title }}</p>
      <p v-if="description" class="text-sm leading-6 text-(--color-text-muted)">{{ description }}</p>
    </div>
    <NuxtLink
      v-if="actionTo && actionLabel"
      :to="actionTo"
      data-testid="empty-state-action"
      class="mt-1 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-(--color-accent) px-5 text-sm font-semibold text-(--color-fill-text) shadow-(--shadow-sm) transition-colors duration-150 hover:bg-(--color-accent-deep) active:bg-(--color-accent-pressed)"
    >
      {{ actionLabel }}
    </NuxtLink>
    <slot />
  </div>
</template>
