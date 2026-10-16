<!-- apps/provider-panel/src/components/services/ServiceImageField.vue -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import {
  SERVICE_IMAGE_ACCEPT,
  imageDraftError,
  markImageForRemoval,
  savedImageUrl,
  selectImageFile,
  stagedImageFile,
  undoImageChange,
  validateServiceImageFile,
  type ServiceImageDraft,
} from './service-image-draft'

// Edits a draft only -- it never talks to the API. The parent decides when the draft is
// sent (the add form's «افزودن», a row's «ذخیره») and writes a failure back into the draft's
// `error`, which keeps the staged file in place for a retry.
const props = withDefaults(
  defineProps<{
    modelValue: ServiceImageDraft
    /** Used as the preview's alt text. */
    serviceName: string
    /** A save that includes this image is in flight: no edits, and an in-progress overlay. */
    busy?: boolean
  }>(),
  { busy: false },
)
const emit = defineEmits<{ 'update:modelValue': [draft: ServiceImageDraft] }>()

const inputId = useId()
const errorId = useId()
const input = ref<HTMLInputElement | null>(null)
// A rejected pick (wrong type, too large) is reported here and leaves the draft untouched --
// choosing a bad file must never throw away the image that was already there.
const pickError = ref('')
// A rejected pick never emits, so any new draft comes from the parent (row «انصراف», a
// successful save, the add form's reset) or from a later valid pick -- either way the old
// rejection no longer describes what the field holds.
watch(
  () => props.modelValue,
  () => {
    pickError.value = ''
  },
)

// One object URL per staged File, owned by this instance: created when the draft starts
// holding a new file, revoked when it stops (undo, another pick, a successful save resetting
// the draft) and on unmount.
const objectUrl = ref<string | null>(null)
function revokePreview() {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
  objectUrl.value = null
}
watch(
  () => stagedImageFile(props.modelValue),
  (file) => {
    revokePreview()
    if (file) objectUrl.value = URL.createObjectURL(file)
  },
  { immediate: true },
)
onBeforeUnmount(revokePreview)

const previewSrc = computed(() => objectUrl.value ?? savedImageUrl(props.modelValue))
const altText = computed(() => props.serviceName.trim() || 'تصویر خدمت')
const errorText = computed(() => pickError.value || imageDraftError(props.modelValue))

const STATUS_TEXT: Record<ServiceImageDraft['kind'], string> = {
  none: 'بدون تصویر',
  staged: 'تصویر انتخاب شد؛ هنوز ذخیره نشده است.',
  existing: 'تصویر فعلی خدمت',
  replacing: 'تصویر جدید جایگزین تصویر فعلی می‌شود؛ هنوز ذخیره نشده است.',
  removing: 'تصویر با ذخیره حذف می‌شود.',
}

function update(draft: ServiceImageDraft) {
  pickError.value = ''
  emit('update:modelValue', draft)
}

function openPicker() {
  input.value?.click()
}

function onFileChange(event: Event) {
  const el = event.target as HTMLInputElement
  const file = el.files?.[0]
  // Cleared so picking the same file again still fires `change` (e.g. after an undo).
  el.value = ''
  // A dismissed picker arrives as an empty selection -- it is not a request to remove.
  if (!file) return
  const error = validateServiceImageFile(file)
  if (error) {
    pickError.value = error
    return
  }
  update(selectImageFile(props.modelValue, file))
}
</script>

<template>
  <div class="flex items-start gap-3" data-testid="service-image-field" :data-state="modelValue.kind">
    <!-- Fixed square box whatever the state, so choosing/clearing an image never moves the
         rest of the card. -->
    <div
      class="relative size-20 shrink-0 overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface-subtle)"
    >
      <img
        v-if="previewSrc"
        :src="previewSrc"
        :alt="altText"
        class="size-full object-cover transition-opacity"
        :class="modelValue.kind === 'removing' ? 'opacity-40 grayscale' : ''"
        data-testid="service-image-preview"
      />
      <div
        v-else
        class="flex size-full items-center justify-center text-(--color-text-muted)"
        data-testid="service-image-placeholder"
        aria-hidden="true"
      >
        <AppIcon name="image-off" :size="22" />
      </div>
      <div
        v-if="busy"
        class="absolute inset-0 flex items-center justify-center bg-(--color-surface-card)/70 text-(--color-text)"
        aria-hidden="true"
      >
        <AppIcon name="spinner" :size="20" class="animate-spin" />
      </div>
      <span
        v-else-if="modelValue.kind === 'removing'"
        class="absolute inset-x-0 bottom-0 bg-(--tone-danger-bg) py-0.5 text-center text-xs font-semibold text-(--tone-danger-text)"
      >
        حذف می‌شود
      </span>
    </div>

    <div class="min-w-0 flex-1 space-y-1.5">
      <label :for="inputId" class="block text-xs font-medium text-(--color-text-muted)">تصویر خدمت (اختیاری)</label>
      <p class="text-xs text-(--color-text)" data-testid="service-image-status" aria-live="polite">
        {{ busy ? 'در حال بارگذاری…' : STATUS_TEXT[modelValue.kind] }}
      </p>

      <div class="flex flex-wrap gap-2">
        <AppButton
          v-if="modelValue.kind !== 'removing'"
          variant="secondary"
          :disabled="busy"
          :aria-describedby="errorText ? errorId : undefined"
          data-testid="pick-service-image"
          @click="openPicker"
        >
          <template #icon><AppIcon name="upload" :size="14" /></template>
          {{ modelValue.kind === 'none' ? 'انتخاب تصویر' : 'تغییر تصویر' }}
        </AppButton>
        <AppButton
          v-if="modelValue.kind === 'existing'"
          variant="ghost"
          :disabled="busy"
          data-testid="remove-service-image"
          @click="update(markImageForRemoval(modelValue))"
        >
          <template #icon><AppIcon name="trash" :size="14" /></template>
          حذف تصویر
        </AppButton>
        <AppButton
          v-if="modelValue.kind === 'staged' || modelValue.kind === 'replacing' || modelValue.kind === 'removing'"
          variant="ghost"
          :disabled="busy"
          data-testid="undo-service-image"
          @click="update(undoImageChange(modelValue))"
        >
          <template #icon><AppIcon name="reset" :size="14" /></template>
          {{
            modelValue.kind === 'staged'
              ? 'انصراف از این تصویر'
              : modelValue.kind === 'replacing'
                ? 'بازگشت به تصویر فعلی'
                : 'بازگرداندن تصویر'
          }}
        </AppButton>
      </div>

      <p class="text-xs text-(--color-text-muted)">حداکثر ۵ مگابایت — jpeg, png, webp</p>
      <!-- Always rendered so screen readers have a live region to announce into. -->
      <p
        :id="errorId"
        aria-live="polite"
        class="text-xs text-(--tone-danger-text)"
        :class="errorText ? 'flex items-start gap-1.5' : ''"
        data-testid="service-image-error"
      >
        <template v-if="errorText">
          <AppIcon name="warning" :size="14" class="mt-0.5 shrink-0" />
          <span class="min-w-0 break-words">{{ errorText }}</span>
        </template>
      </p>
    </div>

    <!-- Off-screen but still the label's target; the visible «انتخاب/تغییر تصویر» button is
         the keyboard path, so the input itself stays out of the tab order. -->
    <input
      :id="inputId"
      ref="input"
      type="file"
      :accept="SERVICE_IMAGE_ACCEPT"
      class="sr-only"
      tabindex="-1"
      :disabled="busy"
      data-testid="service-image-input"
      @change="onFileChange"
    />
  </div>
</template>
