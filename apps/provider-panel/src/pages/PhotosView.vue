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
const loadError = ref(false)
const busyId = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = false

  const { data, error } = await apiFetch<SalonPhoto[]>('/salons/mine/photos', { silent: true })
  if (error) {
    loadError.value = true
    loading.value = false
    return
  }

  photos.value = data ?? []
  loading.value = false
}

onMounted(load)

function onUploaded(photo: SalonPhoto) {
  photos.value.push(photo)
}

async function setCover(id: string) {
  if (busyId.value) return
  busyId.value = id
  const { error } = await apiFetch(`/salons/mine/photos/${id}`, { method: 'PATCH', body: { isCover: true } })
  busyId.value = null
  // Only mutate local state on a real success -- an unconditional local flip would
  // silently lie about the outcome if the request failed (mirrors CouponsView.vue's
  // deactivate()).
  if (!error) {
    for (const p of photos.value) p.isCover = p.id === id
  }
}

// Deleting the salon's current cover photo does not auto-promote another photo to
// cover (see salon-photos.controller.ts's remove()) -- it just silently zeroes the
// salon's cover out. Warn distinctly for that case rather than using the same generic
// confirm copy as any other photo.
async function removePhoto(photo: SalonPhoto) {
  if (busyId.value) return
  const message = photo.isCover
    ? 'این عکس، عکس اصلی شماست. حذف شود؟'
    : 'این تصویر حذف شود؟'
  if (!window.confirm(message)) return

  busyId.value = photo.id
  const { error } = await apiFetch(`/salons/mine/photos/${photo.id}`, { method: 'DELETE' })
  busyId.value = null
  if (!error) {
    photos.value = photos.value.filter((p) => p.id !== photo.id)
  }
}
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold text-(--color-text)">تصاویر آرایشگاه</h1>
    <PhotoUploader @uploaded="onUploaded" />

    <div v-if="loadError" class="space-y-3 rounded-xl border border-dashed border-(--color-border) p-4 text-center">
      <p class="text-sm text-(--tone-danger-text)">تصاویر بارگذاری نشد.</p>
      <AppButton type="button" variant="secondary" data-testid="retry-photos" @click="load">
        تلاش دوباره
      </AppButton>
    </div>

    <template v-else>
      <div v-if="loading" class="flex items-center justify-center py-8 text-(--color-text-muted)">
        <AppIcon name="spinner" :size="20" class="animate-spin" />
      </div>

      <template v-else>
        <EmptyState v-if="photos.length === 0" icon="photos" message="هنوز تصویری بارگذاری نشده است." />

        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          <div v-for="p in photos" :key="p.id" class="overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-sm)">
            <div class="relative aspect-square w-full">
              <img :src="p.url" :alt="p.isCover ? 'عکس اصلی آرایشگاه' : 'تصویر آرایشگاه'" class="h-full w-full object-cover" />
              <span
                v-if="p.isCover"
                class="absolute end-2 top-2 rounded-full bg-(--color-accent-strong) px-2 py-0.5 text-xs font-bold text-white shadow-(--shadow-sm)"
              >
                عکس اصلی
              </span>
            </div>
            <div class="flex items-center justify-between p-2">
              <AppButton
                type="button"
                variant="ghost"
                data-testid="set-cover"
                :loading="busyId === p.id"
                :disabled="p.isCover || busyId === p.id"
                @click="setCover(p.id)"
              >
                {{ p.isCover ? 'انتخاب شده' : 'انتخاب به‌عنوان اصلی' }}
              </AppButton>
              <AppButton
                type="button"
                variant="danger"
                data-testid="delete-photo"
                aria-label="حذف تصویر"
                :loading="busyId === p.id"
                :disabled="busyId === p.id"
                @click="removePhoto(p)"
              >
                <template #icon><AppIcon name="trash" :size="15" /></template>
              </AppButton>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
