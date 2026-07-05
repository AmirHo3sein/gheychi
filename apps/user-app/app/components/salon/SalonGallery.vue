<script setup lang="ts">
defineProps<{ photos: { id: string; url: string }[] }>()
</script>

<template>
  <div v-if="photos.length" class="flex gap-2 overflow-x-auto">
    <NuxtImg
      v-for="photo in photos"
      :key="photo.id"
      provider="arvancloud"
      :src="photo.url"
      width="280"
      height="200"
      loading="lazy"
      class="h-48 w-70 flex-shrink-0 rounded-xl object-cover"
      alt=""
    />
  </div>
  <div v-else class="h-48 rounded-xl bg-(--color-surface-card) flex items-center justify-center text-sm">
    تصویری موجود نیست
  </div>
</template>
