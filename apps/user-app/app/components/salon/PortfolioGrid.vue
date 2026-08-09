<!-- apps/user-app/app/components/salon/PortfolioGrid.vue -->
<script setup lang="ts">
import type { SalonPortfolioItem } from '../../utils/types'
import { lockBodyScroll } from '../../utils/scroll-lock'

const props = defineProps<{
  items: SalonPortfolioItem[]
  services: { id: string; name: string }[]
  slug: string
  salonId: string
  /** Same eligibility flag as the salon page's report button (completed booking). */
  canReport?: boolean
}>()

const lightboxItem = ref<SalonPortfolioItem | null>(null)
const reportOpen = ref(false)

// The booking pill only renders when the item's linked service is one of the page's
// already-fetched (bookable) services -- a stale serviceId simply shows no pill.
const lightboxService = computed(() => {
  const serviceId = lightboxItem.value?.serviceId
  if (!serviceId) return null
  return props.services.find((service) => service.id === serviceId) ?? null
})

let unlockScroll: (() => void) | undefined

function openLightbox(item: SalonPortfolioItem) {
  lightboxItem.value = item
  // Overlay covers the page -- freeze background scroll (restored on close/unmount).
  unlockScroll ??= lockBodyScroll()
}

function closeLightbox() {
  lightboxItem.value = null
  reportOpen.value = false
  unlockScroll?.()
  unlockScroll = undefined
}

onBeforeUnmount(() => {
  unlockScroll?.()
})

const dialogRoot = ref<HTMLElement | null>(null)
// Paused while the embedded ReportForm (its own nested dialog) is open on top.
const { titleId } = useDialog(dialogRoot, { onClose: closeLightbox, enabled: () => !reportOpen.value })
</script>

<template>
  <section>
    <h2 class="mb-2 flex items-center gap-1.5 text-lg font-bold text-(--color-text)">
      <BaseIcon name="camera" :size="17" class="text-(--color-text-muted)" />
      نمونه کارها
    </h2>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        data-testid="portfolio-item"
        class="text-start"
        @click="openLightbox(item)"
      >
        <NuxtImg
          provider="arvancloud"
          :src="item.url"
          width="300"
          height="300"
          loading="lazy"
          class="aspect-square w-full rounded-xl object-cover"
          :alt="item.caption || 'نمونه کار سالن'"
        />
        <!-- A grid track is minmax(0, 1fr) so the box shrinks fine, but a caption with a
             long unbreakable run would still spill out of it (~122px wide at 320px). -->
        <p v-if="item.caption" class="mt-1 text-xs break-words text-(--color-text-muted)">{{ item.caption }}</p>
      </button>
    </div>

    <div
      v-if="lightboxItem"
      data-testid="portfolio-lightbox"
      class="fixed inset-0 bg-black/80 flex items-start justify-center overflow-y-auto overscroll-contain p-4 z-50"
      @click.self="closeLightbox"
    >
      <!-- items-start + my-auto, not items-center: on a short viewport (a phone held in
           landscape, ~360px tall) the 70vh image plus caption, booking pill, report link
           and close button are taller than the overlay, and `items-center` on an
           overflowing flex container pushes the excess off BOTH ends -- the top is then
           unreachable by scrolling and "بستن" sits below the fold with no way to reach it.
           A cross-axis auto margin centers exactly the same way when there IS free space
           and collapses to zero when there isn't, so the overlay just scrolls instead. -->
      <div
        ref="dialogRoot"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        class="my-auto w-full max-w-sm space-y-3 text-center outline-none"
      >
        <h2 :id="titleId" class="sr-only">نمایش نمونه کار</h2>
        <NuxtImg
          provider="arvancloud"
          :src="lightboxItem.url"
          width="600"
          height="600"
          class="max-h-[70vh] w-full rounded-xl object-contain"
          :alt="lightboxItem.caption || 'نمونه کار سالن'"
        />
        <p v-if="lightboxItem.caption" class="text-sm break-words text-white">{{ lightboxItem.caption }}</p>
        <NuxtLink
          v-if="lightboxService"
          :to="`/booking/${slug}/${lightboxService.id}`"
          data-testid="portfolio-booking-pill"
          class="inline-flex min-h-11 items-center rounded-full bg-(--color-accent) px-4 text-sm font-semibold text-(--color-fill-text)"
        >
          رزرو این خدمت
        </NuxtLink>
        <button
          v-if="canReport"
          type="button"
          data-testid="portfolio-report-button"
          class="inline-flex min-h-11 items-center text-xs text-white/70 underline"
          @click="reportOpen = true"
        >
          گزارش این نمونه کار
        </button>
        <button
          type="button"
          data-testid="portfolio-lightbox-close"
          class="min-h-11 w-full text-sm text-white"
          @click="closeLightbox"
        >
          بستن
        </button>
      </div>
    </div>

    <!-- Renders above the lightbox (same z-index, later in the DOM). -->
    <ReportForm
      v-if="reportOpen && lightboxItem"
      :salon-id="salonId"
      :portfolio-item-id="lightboxItem.id"
      @close="reportOpen = false"
    />
  </section>
</template>
