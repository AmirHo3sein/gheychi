<!-- apps/admin-panel/src/components/ui/SafeImage.vue -->
<!-- An <img> that degrades to a labelled placeholder when the file is missing or blocked.
     In an approval review a silently collapsed image reads as "no photo", which is a
     different (and wrong) conclusion from "the photo failed to load". -->
<script setup lang="ts">
import { ref, watch } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ src: string; alt: string }>()
const failed = ref(false)
watch(() => props.src, () => (failed.value = false))
</script>

<template>
  <div
    v-if="failed"
    data-testid="image-fallback"
    role="img"
    :aria-label="`${alt} (بارگذاری نشد)`"
    class="flex h-full w-full flex-col items-center justify-center gap-1 bg-(--color-border-soft) p-2 text-center text-xs text-(--color-text-muted)"
  >
    <AppIcon name="warning" :size="18" />
    تصویر بارگذاری نشد
  </div>
  <img v-else :src="src" :alt="alt" loading="lazy" class="h-full w-full object-cover" @error="failed = true" />
</template>
