<script setup lang="ts">
defineProps<{ photos: { id: string; url: string }[] }>()
</script>

<template>
  <div v-if="photos.length" class="flex gap-2 overflow-x-auto">
    <NuxtImg
      v-for="(photo, index) in photos"
      :key="photo.id"
      provider="arvancloud"
      :src="photo.url"
      width="280"
      height="200"
      loading="lazy"
      class="h-48 w-70 flex-shrink-0 rounded-xl object-cover"
      :alt="`تصویر گالری سالن ${index + 1}`"
    />
  </div>
  <div v-else class="h-48">
    <SalonImagePlaceholder :icon-size="36" />
  </div>
</template>
