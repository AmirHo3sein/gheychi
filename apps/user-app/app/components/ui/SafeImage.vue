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

// Same sizing rule as SalonImagePlaceholder: ~1.25x the icon size, capped, so a failed tiny
// thumb gets a tiny mark and a failed hero never gets a giant one.
const markSize = computed(() => Math.min(56, Math.max(18, Math.round(props.placeholderIconSize * 1.25))))

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
  <!-- Same branded treatment as SalonImagePlaceholder (blush -> peach wash + faded قیچی mark)
       instead of a grey scissors that read as "broken". The mark is a CSS background, never an
       <img>, so the box's own role="img" + aria-label stays the only accessible image here. -->
  <div
    v-if="failed"
    v-bind="$attrs"
    role="img"
    :aria-label="alt"
    data-testid="salon-image-placeholder"
    class="flex items-center justify-center bg-linear-to-br from-(--color-surface-subtle) to-(--color-accent-soft) text-(--color-text-muted)"
  >
    <span
      aria-hidden="true"
      data-testid="placeholder-brand-mark"
      class="block rounded-[28%] bg-cover bg-center opacity-55 mix-blend-multiply saturate-[.8] dark:opacity-40 dark:mix-blend-normal"
      :style="{ width: `${markSize}px`, height: `${markSize}px`, backgroundImage: 'url(/brand-icon.png)' }"
    />
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
