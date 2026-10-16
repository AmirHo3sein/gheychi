<!-- apps/user-app/app/components/beauty-guide/GuideServiceThumb.vue
     A matched service's fixed-square thumbnail, the same idiom as the salon page's
     service-thumb: explicit width/height + a fixed box so a lazy photo never shifts the row,
     object-cover, and SafeImage's own failed-load -> placeholder fallback. A service without a
     photo gets the brand placeholder so the names in a block that has SOME photos line up. -->
<script setup lang="ts">
defineProps<{ imageUrl?: string | null; name: string }>()
</script>

<template>
  <div
    data-testid="guide-service-thumb"
    class="size-14 shrink-0 overflow-hidden rounded-xl bg-(--color-surface-subtle) min-[360px]:size-16"
  >
    <SafeImage
      v-if="imageUrl"
      :src="imageUrl"
      :alt="name"
      :width="128"
      :height="128"
      loading="lazy"
      :placeholder-icon-size="20"
      class="h-full w-full object-cover"
    />
    <SalonImagePlaceholder v-else :icon-size="20" />
  </div>
</template>
