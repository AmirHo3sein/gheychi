<!-- apps/admin-panel/src/components/ui/SafeImage.vue -->
<!-- An <img> that degrades to a labelled placeholder when the file is missing or blocked.
     In an approval review a silently collapsed image reads as "no photo", which is a
     different (and wrong) conclusion from "the photo failed to load". -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'

// `compact` is for thumbnail-sized boxes (e.g. the 40px service thumbnail in
// SalonReviewPanel): the full fallback (icon + a visible sentence) cannot fit there and was
// clipped to an unreadable fragment, so compact mode shows the icon alone and carries the
// same message through the role="img" aria-label plus a hover title instead. Larger call
// sites leave it off and keep the visible text.
const props = withDefaults(defineProps<{ src: string; alt: string; compact?: boolean }>(), { compact: false })
const failed = ref(false)
watch(() => props.src, () => (failed.value = false))
</script>

<template>
  <div
    v-if="failed"
    data-testid="image-fallback"
    role="img"
    :aria-label="`${alt} (بارگذاری نشد)`"
    :title="compact ? 'تصویر بارگذاری نشد' : undefined"
    class="flex h-full w-full flex-col items-center justify-center gap-1 bg-(--color-border-soft) text-center text-xs text-(--color-text-muted)"
    :class="compact ? 'p-0' : 'p-2'"
  >
    <AppIcon name="warning" :size="compact ? 16 : 18" />
    <template v-if="!compact">تصویر بارگذاری نشد</template>
  </div>
  <img v-else :src="src" :alt="alt" loading="lazy" class="h-full w-full object-cover" @error="failed = true" />
</template>
