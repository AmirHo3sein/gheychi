<!-- apps/user-app/app/components/salon/StoriesRing.vue -->
<script setup lang="ts">
import type { SalonStoryItem } from '../../utils/types'
import { hasUnseenStories, newestStoryCreatedAt } from '../../utils/story-seen'

const props = defineProps<{
  stories: SalonStoryItem[]
  coverPhoto: string | null
  lastSeen: string | null
}>()

defineEmits<{ open: [] }>()

// Bright gradient ring while a story newer than the recorded seen-state exists; dims once
// the viewer has caught up (localStorage-only seen-state, passed down as a prop).
const hasUnseen = computed(() => hasUnseenStories(props.lastSeen, newestStoryCreatedAt(props.stories)))
</script>

<template>
  <!-- Single explicit aria-label rather than letting the accessible name assemble from the
       cover-photo alt + the "استوری" caption below -- the photo is a decorative preview
       thumbnail of a control whose action is already fully described here. -->
  <button
    type="button"
    data-testid="stories-ring"
    aria-label="مشاهده استوری‌های سالن"
    class="flex flex-col items-center gap-1"
    @click="$emit('open')"
  >
    <span
      class="rounded-full p-[3px]"
      :class="hasUnseen ? 'bg-gradient-to-tr from-(--color-accent) to-(--color-ad)' : 'bg-(--color-surface-card) opacity-60'"
      :data-seen="hasUnseen ? undefined : 'true'"
    >
      <NuxtImg
        v-if="coverPhoto"
        provider="arvancloud"
        :src="coverPhoto"
        width="64"
        height="64"
        class="block h-16 w-16 rounded-full border-2 border-(--color-surface) object-cover"
        alt=""
      />
      <span v-else class="block h-16 w-16 overflow-hidden rounded-full border-2 border-(--color-surface)">
        <SalonImagePlaceholder icon="sparkles" rounded="full" :icon-size="22" />
      </span>
    </span>
    <span aria-hidden="true" class="text-xs">استوری</span>
  </button>
</template>
