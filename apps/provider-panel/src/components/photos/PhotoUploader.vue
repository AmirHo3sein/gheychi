<!-- apps/provider-panel/src/components/photos/PhotoUploader.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'

interface SalonPhoto {
  id: string
  url: string
  isCover: boolean
  sortOrder: number
}

const emit = defineEmits<{ uploaded: [photo: SalonPhoto] }>()
const { apiFetch } = useApi()
const error = ref('')
const uploading = ref(false)

async function onFileChange(event: Event) {
  error.value = ''
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    error.value = 'فقط تصویر (jpeg, png, webp) مجاز است.'
    input.value = ''
    return
  }

  uploading.value = true
  const form = new FormData()
  form.append('file', file)
  const { data, error: apiError } = await apiFetch<SalonPhoto>('/salons/mine/photos', { method: 'POST', body: form })
  uploading.value = false
  input.value = ''
  if (apiError || !data) {
    error.value = 'بارگذاری تصویر ناموفق بود.'
    return
  }
  emit('uploaded', data)
}
</script>

<template>
  <div>
    <label
      class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-(--color-border) bg-(--color-surface-card) py-8 text-center transition-colors hover:border-(--color-accent)"
    >
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-(--tone-info-bg) text-(--color-accent)">
        <AppIcon name="upload" :size="18" />
      </div>
      <span class="text-sm font-semibold text-(--color-text)">{{ uploading ? 'در حال بارگذاری…' : 'افزودن تصویر جدید' }}</span>
      <span class="text-xs text-(--color-muted)">jpeg, png, webp</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" :disabled="uploading" @change="onFileChange" />
    </label>
    <p v-if="error" class="mt-2 flex items-center gap-1.5 text-sm text-(--tone-danger-text)">
      <AppIcon name="warning" :size="14" class="shrink-0" />
      {{ error }}
    </p>
  </div>
</template>
