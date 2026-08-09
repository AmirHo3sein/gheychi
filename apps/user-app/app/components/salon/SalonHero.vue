<!-- apps/user-app/app/components/salon/SalonHero.vue -->
<!-- Replaces SalonGallery.vue on the salon profile page. That component rendered every photo
     at equal weight in a small horizontal-scroll strip (and a short, wide, oddly-proportioned
     placeholder when there were none) -- the first, most important image on the page had no
     more visual weight than the fifth. This makes the first photo a real hero (fixed aspect
     ratio, loaded eagerly since it's the LCP candidate), with the rest reachable through a tap
     -> full lightbox, a floating favorite button anchored to the image instead of competing
     with the salon name for header width, and a #corner slot for the page to anchor the story
     ring onto the hero's edge (Instagram-style), without this component needing to know
     anything about stories. -->
<script setup lang="ts">
import { lockBodyScroll } from '../../utils/scroll-lock'

interface Photo { id: string; url: string }

const props = defineProps<{
  photos: Photo[]
  /** portfolio[0]?.url -- used only when the salon has no gallery photos of its own. */
  fallbackPhoto: string | null
  salonName: string
  isFavorited: boolean
  favoriteBusy: boolean
}>()

const emit = defineEmits<{ 'toggle-favorite': [] }>()

// A synthetic single-item list when only the fallback exists, so the rest of this
// component (lightbox, counter) never has to special-case "which source is this photo
// from" -- it is just "the hero's photo list", whichever it came from.
const heroPhotos = computed<Photo[]>(() => {
  if (props.photos.length) return props.photos
  if (props.fallbackPhoto) return [{ id: 'fallback', url: props.fallbackPhoto }]
  return []
})

const activeIndex = ref<number | null>(null)
const lightboxOpen = computed(() => activeIndex.value !== null)

let unlockScroll: (() => void) | undefined

function openLightbox(index: number) {
  activeIndex.value = index
  unlockScroll ??= lockBodyScroll()
}

function closeLightbox() {
  activeIndex.value = null
  unlockScroll?.()
  unlockScroll = undefined
}

// "Next" moves forward through the list; in this RTL app that is drawn as chevron-back
// ("<"), matching the codebase's established back/forward icon convention (e.g.
// account/wallet.vue's "بازگشت" link uses chevron-forward, the ">" shape, for the
// opposite -- backward -- direction).
function next() {
  if (activeIndex.value === null) return
  activeIndex.value = (activeIndex.value + 1) % heroPhotos.value.length
}
function prev() {
  if (activeIndex.value === null) return
  activeIndex.value = (activeIndex.value - 1 + heroPhotos.value.length) % heroPhotos.value.length
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') next() // RTL: left arrow advances, matching visual reading order
  else if (event.key === 'ArrowRight') prev()
}

onBeforeUnmount(() => unlockScroll?.())

const dialogRoot = ref<HTMLElement | null>(null)
const { titleId } = useDialog(dialogRoot, { onClose: closeLightbox })
</script>

<template>
  <div class="relative">
    <button
      v-if="heroPhotos.length"
      type="button"
      data-testid="salon-hero-photo"
      class="block h-64 w-full overflow-hidden rounded-2xl sm:h-80"
      :aria-label="`مشاهده گالری تصاویر ${salonName}`"
      @click="openLightbox(0)"
    >
      <NuxtImg
        provider="arvancloud"
        :src="heroPhotos[0]!.url"
        width="672"
        height="320"
        fetchpriority="high"
        class="h-full w-full object-cover"
        :alt="`تصویر اصلی ${salonName}`"
      />
    </button>
    <div v-else data-testid="salon-hero-photo" class="h-64 w-full sm:h-80">
      <SalonImagePlaceholder :icon-size="40" />
    </div>

    <!-- Only when there is something beyond the cover photo to see. -->
    <span
      v-if="heroPhotos.length > 1"
      class="pointer-events-none absolute bottom-3 end-3 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white"
    >
      <BaseIcon name="camera" :size="13" />
      {{ heroPhotos.length.toLocaleString('fa-IR') }}
    </span>

    <button
      type="button"
      :disabled="favoriteBusy"
      :aria-pressed="isFavorited"
      data-testid="favorite-button"
      class="absolute top-3 end-3 flex h-11 w-11 items-center justify-center rounded-full backdrop-blur transition-colors disabled:opacity-60"
      :class="isFavorited ? 'bg-(--color-danger-strong) text-(--color-fill-text)' : 'bg-black/40 text-white hover:bg-black/55'"
      @click="emit('toggle-favorite')"
    >
      <BaseIcon name="heart" :size="18" />
    </button>

    <div class="absolute bottom-3 start-3">
      <slot name="corner" />
    </div>

    <div
      v-if="lightboxOpen"
      data-testid="salon-hero-lightbox"
      class="fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-black/90 p-4"
      @keydown="onKeydown"
      @click.self="closeLightbox"
    >
      <div ref="dialogRoot" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1" class="m-auto w-full max-w-lg outline-none">
        <h2 :id="titleId" class="sr-only">گالری تصاویر {{ salonName }}</h2>
        <div class="relative">
          <NuxtImg
            provider="arvancloud"
            :src="heroPhotos[activeIndex!]!.url"
            width="700"
            height="700"
            class="max-h-[75vh] w-full rounded-xl object-contain"
            :alt="`تصویر ${(activeIndex! + 1).toLocaleString('fa-IR')} از گالری ${salonName}`"
          />
          <template v-if="heroPhotos.length > 1">
            <button
              type="button"
              aria-label="تصویر بعدی"
              data-testid="salon-hero-lightbox-next"
              class="absolute inset-y-0 end-0 flex w-14 items-center justify-center text-white/80 transition-colors hover:text-white"
              @click="next"
            >
              <BaseIcon name="chevron-back" :size="26" />
            </button>
            <button
              type="button"
              aria-label="تصویر قبلی"
              data-testid="salon-hero-lightbox-prev"
              class="absolute inset-y-0 start-0 flex w-14 items-center justify-center text-white/80 transition-colors hover:text-white"
              @click="prev"
            >
              <BaseIcon name="chevron-forward" :size="26" />
            </button>
          </template>
        </div>
        <p v-if="heroPhotos.length > 1" class="tnum mt-3 text-center text-sm text-white/70">
          {{ (activeIndex! + 1).toLocaleString('fa-IR') }} / {{ heroPhotos.length.toLocaleString('fa-IR') }}
        </p>
        <button
          type="button"
          data-testid="salon-hero-lightbox-close"
          class="mt-3 min-h-11 w-full text-sm text-white"
          @click="closeLightbox"
        >
          بستن
        </button>
      </div>
    </div>
  </div>
</template>
