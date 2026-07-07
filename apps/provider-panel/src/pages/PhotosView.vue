<!-- apps/provider-panel/src/pages/PhotosView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PhotoUploader from '@/components/photos/PhotoUploader.vue'
import { useApi } from '@/composables/useApi'

interface SalonPhoto {
  id: string
  url: string
  isCover: boolean
  sortOrder: number
}

const { apiFetch } = useApi()
const photos = ref<SalonPhoto[]>([])

async function load() {
  const { data } = await apiFetch<SalonPhoto[]>('/salons/mine/photos', { silent: true })
  photos.value = data ?? []
}

onMounted(load)

function onUploaded(photo: SalonPhoto) {
  photos.value.push(photo)
}

async function setCover(id: string) {
  await apiFetch(`/salons/mine/photos/${id}`, { method: 'PATCH', body: { isCover: true } })
  await load()
}

async function removePhoto(id: string) {
  await apiFetch(`/salons/mine/photos/${id}`, { method: 'DELETE' })
  await load()
}
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold">تصاویر آرایشگاه</h1>
    <PhotoUploader @uploaded="onUploaded" />

    <div class="grid grid-cols-2 gap-3">
      <div v-for="p in photos" :key="p.id" class="space-y-1">
        <img :src="p.url" class="aspect-square w-full rounded-lg object-cover" />
        <div class="flex justify-between text-xs">
          <button type="button" :disabled="p.isCover" @click="setCover(p.id)">
            {{ p.isCover ? 'عکس اصلی' : 'انتخاب به‌عنوان اصلی' }}
          </button>
          <button type="button" class="text-red-600" @click="removePhoto(p.id)">حذف</button>
        </div>
      </div>
    </div>
  </div>
</template>
