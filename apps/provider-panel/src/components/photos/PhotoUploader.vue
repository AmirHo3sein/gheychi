<!-- apps/provider-panel/src/components/photos/PhotoUploader.vue -->
<script setup lang="ts">
import { ref } from 'vue'
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

  const form = new FormData()
  form.append('file', file)
  const { data, error: apiError } = await apiFetch<SalonPhoto>('/salons/mine/photos', { method: 'POST', body: form })
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
    <input type="file" accept="image/jpeg,image/png,image/webp" @change="onFileChange" />
    <p v-if="error" class="mt-1 text-sm text-red-600">{{ error }}</p>
  </div>
</template>
