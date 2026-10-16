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

// Desktop mosaic only: the two photos after the cover (hidden below lg).
const sidePhotos = computed(() => heroPhotos.value.slice(1, 3))

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
// The cast works around a vue-tsc/vue 3.5.42 template-ref inference mismatch (see
// useDialog.ts's own signature) -- dialogRoot really is Ref<HTMLElement | null> at runtime.
const { titleId } = useDialog(dialogRoot as unknown as Ref<HTMLElement | null>, { onClose: closeLightbox })
</script>

<template>
  <div class="relative">
    <!-- Phones: one hero photo, unchanged. Desktop (lg): a compact mosaic -- the cover plus up
         to two more photos stacked beside it -- at a shorter height than the old 26rem single
         image, so the salon's name and the booking aside are visible without scrolling and the
         page leads with more of the salon than one cropped photo. Every tile opens the same
         lightbox at its own index. -->
    <div
      v-if="heroPhotos.length"
      class="lg:grid lg:h-[22rem] lg:gap-2"
      :class="sidePhotos.length ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : ''"
    >
      <button
        type="button"
        data-testid="salon-hero-photo"
        class="block h-64 w-full overflow-hidden rounded-2xl sm:h-80 lg:h-full"
        :aria-label="`مشاهده گالری تصاویر ${salonName}`"
        @click="openLightbox(0)"
      >
        <SafeImage
          :src="heroPhotos[0]!.url"
          width="1024"
          height="416"
          fetchpriority="high"
          class="h-full w-full object-cover"
          :alt="`تصویر اصلی ${salonName}`"
        />
      </button>
      <div
        v-if="sidePhotos.length"
        class="hidden min-h-0 gap-2 lg:grid"
        :class="sidePhotos.length > 1 ? 'grid-rows-2' : ''"
      >
        <button
          v-for="(photo, i) in sidePhotos"
          :key="photo.id"
          type="button"
          data-testid="salon-hero-side-photo"
          class="block min-h-0 overflow-hidden rounded-2xl"
          :aria-label="`مشاهده تصویر ${(i + 2).toLocaleString('fa-IR')} از گالری ${salonName}`"
          @click="openLightbox(i + 1)"
        >
          <SafeImage
            :src="photo.url"
            width="480"
            height="340"
            loading="lazy"
            class="h-full w-full object-cover transition-transform duration-200 hover:scale-[1.02] motion-reduce:transition-none motion-reduce:hover:scale-100"
            alt=""
          />
        </button>
      </div>
    </div>
    <!-- No photo at all: a shorter branded band on wider screens -- a 22rem empty tile above the
         fold says nothing the salon name below doesn't. -->
    <div v-else data-testid="salon-hero-photo" class="h-48 w-full sm:h-56">
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
      :aria-label="isFavorited ? 'حذف از سالن‌های ذخیره‌شده' : 'ذخیره سالن'"
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
      <div ref="dialogRoot" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1" class="m-auto w-full max-w-lg outline-none lg:max-w-3xl">
        <h2 :id="titleId" class="sr-only">گالری تصاویر {{ salonName }}</h2>
        <div class="relative">
          <SafeImage
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
