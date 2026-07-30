<!-- apps/provider-panel/src/components/photos/PhotoUploader.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'

const props = withDefaults(
  defineProps<{
    /** API path receiving the multipart POST. The default keeps PhotosView's original behavior. */
    endpoint?: string
    /** Extra text fields appended to the multipart form alongside `file` (e.g. caption/serviceId). */
    extraFields?: Record<string, string>
  }>(),
  { endpoint: '/salons/mine/photos', extraFields: () => ({}) },
)

// Every endpoint this uploader targets (photos, stories, portfolio) caps the upload at 5 MB
// via the same multer `limits.fileSize`, and Nest turns multer's LIMIT_FILE_SIZE into a bare
// 413 with no usable body -- so the limit has to be stated and checked here, in one place.
// Straight-from-the-phone photos routinely exceed it, and without this the provider only saw
// the generic failure text with no hint that resizing would fix it.
const MAX_FILE_BYTES = 5 * 1024 * 1024
const FILE_TOO_LARGE_ERROR = 'حجم تصویر باید کمتر از ۵ مگابایت باشد.'

// The created row's shape depends on the target endpoint (photo vs. story vs. portfolio
// item) -- the uploader just relays whatever the API returned; callers type their own
// @uploaded handler, so the payload is deliberately `any`.
const emit = defineEmits<{ uploaded: [item: any] }>()
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

  if (file.size > MAX_FILE_BYTES) {
    error.value = FILE_TOO_LARGE_ERROR
    input.value = ''
    return
  }

  uploading.value = true
  const form = new FormData()
  form.append('file', file)
  for (const [key, value] of Object.entries(props.extraFields)) form.append(key, value)
  const { data, error: apiError } = await apiFetch<object>(props.endpoint, { method: 'POST', body: form })
  uploading.value = false
  input.value = ''
  if (apiError || !data) {
    // A 409 is a business-rule rejection with a Persian message from the API (the
    // story/portfolio caps) -- surface it verbatim. The photos endpoint has no cap,
    // so the default-endpoint (PhotosView) failure text is unchanged.
    if (apiError?.status === 409 && apiError.message) {
      error.value = apiError.message
    } else if (apiError?.status === 413) {
      // The client-side size check above normally catches this first; a 413 still reaches
      // here when the browser reports a stale/rounded size, so give it the same reason
      // rather than the generic failure text.
      error.value = FILE_TOO_LARGE_ERROR
    } else {
      error.value = 'بارگذاری تصویر ناموفق بود.'
    }
    return
  }
  emit('uploaded', data)
}
</script>

<template>
  <div>
    <label
      class="relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-(--color-border) bg-(--color-surface-card) py-8 text-center transition-colors hover:border-(--color-accent) has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-(--color-accent)/30"
    >
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-(--color-accent-soft) text-(--color-accent-text)">
        <AppIcon name="upload" :size="18" />
      </div>
      <span class="text-sm font-semibold text-(--color-text)">{{ uploading ? 'در حال بارگذاری…' : 'افزودن تصویر جدید' }}</span>
      <span class="text-xs text-(--color-text-muted)">حداکثر ۵ مگابایت — jpeg, png, webp</span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        class="absolute h-px w-px overflow-hidden opacity-0"
        :disabled="uploading"
        @change="onFileChange"
      />
    </label>
    <p v-if="error" class="mt-2 flex items-center gap-1.5 text-sm text-(--tone-danger-text)">
      <AppIcon name="warning" :size="14" class="shrink-0" />
      {{ error }}
    </p>
  </div>
</template>
