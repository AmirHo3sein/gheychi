<!-- apps/provider-panel/src/pages/PhotosView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PhotoUploader from '@/components/photos/PhotoUploader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useApi } from '@/composables/useApi'

interface SalonPhoto {
  id: string
  url: string
  isCover: boolean
  sortOrder: number
}

const { apiFetch } = useApi()
const photos = ref<SalonPhoto[]>([])
const loading = ref(true)

async function load() {
  const { data } = await apiFetch<SalonPhoto[]>('/salons/mine/photos', { silent: true })
  photos.value = data ?? []
  loading.value = false
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
    <h1 class="text-lg font-bold text-(--color-text)">تصاویر آرایشگاه</h1>
    <PhotoUploader @uploaded="onUploaded" />

    <EmptyState v-if="!loading && photos.length === 0" icon="photos" message="هنوز تصویری بارگذاری نشده است." />

    <div v-else class="grid grid-cols-2 gap-3">
      <div v-for="p in photos" :key="p.id" class="overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-sm)">
        <div class="relative aspect-square w-full">
          <img :src="p.url" class="h-full w-full object-cover" />
          <span
            v-if="p.isCover"
            class="absolute end-2 top-2 rounded-full bg-(--color-accent) px-2 py-0.5 text-[10px] font-bold text-white shadow-(--shadow-sm)"
          >
            عکس اصلی
          </span>
        </div>
        <div class="flex items-center justify-between p-2">
          <AppButton type="button" variant="ghost" :disabled="p.isCover" @click="setCover(p.id)">
            {{ p.isCover ? 'انتخاب شده' : 'انتخاب به‌عنوان اصلی' }}
          </AppButton>
          <AppButton type="button" variant="danger" @click="removePhoto(p.id)">
            <template #icon><AppIcon name="trash" :size="15" /></template>
          </AppButton>
        </div>
      </div>
    </div>
  </div>
</template>
