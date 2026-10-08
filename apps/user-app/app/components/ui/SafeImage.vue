<!-- apps/user-app/app/components/ui/SafeImage.vue
     NuxtImg that degrades to the brand placeholder when the image can't load. Uploaded photos
     live on a single host/volume (or a CDN) and a missing or failed file used to leave the
     browser's broken-image glyph plus raw alt text and a big empty box -- on a salon page that
     reads as a broken product. Every salon/portfolio photo goes through this instead.
     `class` lands on whichever element is shown (the <img>, or the placeholder box), so the
     caller's sizing/rounding/aspect classes keep working in both states. -->
<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    src: string
    alt: string
    width?: number | string
    height?: number | string
    loading?: 'lazy' | 'eager'
    placeholderIconSize?: number
  }>(),
  { loading: undefined, width: undefined, height: undefined, placeholderIconSize: 28 },
)

const failed = ref(false)
const imgRef = ref<{ $el?: HTMLImageElement } | null>(null)

// A new source (e.g. the lightbox moving to the next photo) deserves a fresh attempt.
watch(() => props.src, () => { failed.value = false })

// The image can fail while the page is still server-rendered HTML, i.e. BEFORE hydration
// attaches the @error listener, and the event is never replayed. Catch that case on mount.
onMounted(() => {
  const el = imgRef.value?.$el
  if (el && el.complete && el.naturalWidth === 0) failed.value = true
})
</script>

<template>
  <div v-if="failed" v-bind="$attrs" role="img" :aria-label="alt" data-testid="salon-image-placeholder" class="flex items-center justify-center bg-(--color-surface-subtle) text-(--color-text-muted)">
    <BaseIcon name="scissors" :size="placeholderIconSize" class="opacity-50" />
  </div>
  <NuxtImg
    v-else
    ref="imgRef"
    provider="arvancloud"
    :src="src"
    :alt="alt"
    :width="width"
    :height="height"
    :loading="loading"
    v-bind="$attrs"
    @error="failed = true"
  />
</template>
