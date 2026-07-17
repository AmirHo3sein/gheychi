<script setup lang="ts">
import type { SalonPortfolioItem, SalonStoryItem } from '../../utils/types'
import { resolveSalonDescription } from '../../utils/salon-seo'
import { readStorySeen } from '../../utils/story-seen'

interface Salon {
  id: string
  name: string
  description: string | null
  address: string
  city: string
  ratingAvg: string
  ratingCount: number
  tagline: string | null
  about: string | null
  instagramHandle: string | null
}
interface SalonServiceItem { id: string; name: string; description: string | null; price: number; durationMin: number }
interface WorkingHourItem { weekday: number; openTime: string; closeTime: string }
interface PhotoItem { id: string; url: string }
interface ReviewItem { id: string; rating: number; comment: string | null; salonReply: string | null; createdAt: string }

const route = useRoute()
const slug = route.params.slug as string
const { apiFetch } = useApi()
const session = useSessionStore()

const { data: page } = await useAsyncData(`salon-${slug}`, async () => {
  const salonRes = await apiFetch<Salon>(`/salons/${slug}`, { silent: true })
  if (!salonRes.data) return null

  const [servicesRes, hoursRes, photosRes, reviewsRes, portfolioRes] = await Promise.all([
    apiFetch<SalonServiceItem[]>(`/salons/${slug}/services`, { silent: true }),
    apiFetch<WorkingHourItem[]>(`/salons/${slug}/hours`, { silent: true }),
    apiFetch<PhotoItem[]>(`/salons/${slug}/photos`, { silent: true }),
    apiFetch<ReviewItem[]>(`/salons/${salonRes.data.id}/reviews`, { silent: true }),
    apiFetch<SalonPortfolioItem[]>(`/salons/${slug}/portfolio`, { silent: true }),
  ])

  return {
    salon: salonRes.data,
    services: servicesRes.data ?? [],
    hours: hoursRes.data ?? [],
    photos: photosRes.data ?? [],
    reviews: reviewsRes.data ?? [],
    portfolio: portfolioRes.data ?? [],
  }
})

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Salon not found' })
}

// about-excerpt ?? tagline ?? description ?? name—address (empty strings fall through).
const seoDescription = resolveSalonDescription(page.value.salon)

useSeoMeta({
  title: page.value.salon.name,
  description: seoDescription,
  ogTitle: page.value.salon.name,
  // Falls back to the first portfolio image when the salon has no gallery photos.
  ogImage: page.value.photos[0]?.url ?? page.value.portfolio[0]?.url,
})

useHead({
  script: [
    {
      type: 'application/ld+json',
      // The < escaping matters: stringify does NOT escape a closing script tag, so a
      // provider-authored name/address containing one could otherwise break out of this block.
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BeautySalon',
        name: page.value.salon.name,
        description: seoDescription,
        address: { '@type': 'PostalAddress', streetAddress: page.value.salon.address, addressLocality: page.value.salon.city },
        // The API's handle regex ([A-Za-z0-9._]{1,30}) is what makes this interpolation safe.
        sameAs: page.value.salon.instagramHandle
          ? [`https://instagram.com/${page.value.salon.instagramHandle}`]
          : undefined,
        aggregateRating: page.value.salon.ratingCount > 0
          ? { '@type': 'AggregateRating', ratingValue: page.value.salon.ratingAvg, reviewCount: page.value.salon.ratingCount }
          : undefined,
      }).replace(/[<]/g, '\\u003c'),
    },
  ],
})

const isFavorited = ref(false)
const favoriteBusy = ref(false)
const canReport = ref(false)
const reportOpen = ref(false)
const reportReviewId = ref<string | null>(null)

// Stories are ephemeral (24h TTL) and their ring state lives in localStorage, so both are
// client-only -- never part of the SSR payload.
const stories = ref<SalonStoryItem[]>([])
const storySeen = ref<string | null>(null)
const viewerOpen = ref(false)

onMounted(async () => {
  storySeen.value = readStorySeen(page.value!.salon.id)
  const storiesPromise = apiFetch<SalonStoryItem[]>(`/salons/${slug}/stories`, { silent: true })

  if (session.isLoggedIn) {
    const [favoritesRes, eligibilityRes] = await Promise.all([
      apiFetch<Salon[]>('/favorites', { silent: true }),
      apiFetch<{ canReport: boolean }>('/reports/eligibility', {
        query: { salonId: page.value!.salon.id },
        silent: true,
      }),
    ])
    isFavorited.value = !!favoritesRes.data?.some((s) => s.id === page.value!.salon.id)
    canReport.value = !!eligibilityRes.data?.canReport
  }

  stories.value = (await storiesPromise).data ?? []
})

function closeStoryViewer() {
  viewerOpen.value = false
  // The viewer records seen-state to localStorage as it plays; re-read so the ring dims.
  storySeen.value = readStorySeen(page.value!.salon.id)
}

function openSalonReport() {
  reportReviewId.value = null
  reportOpen.value = true
}

function openReviewReport(reviewId: string) {
  reportReviewId.value = reviewId
  reportOpen.value = true
}

function closeReport() {
  reportOpen.value = false
  reportReviewId.value = null
}

async function toggleFavorite() {
  favoriteBusy.value = true
  const method = isFavorited.value ? 'DELETE' : 'POST'
  const { error } = await apiFetch(`/salons/${page.value!.salon.id}/favorite`, { method })
  favoriteBusy.value = false
  if (!error) isFavorited.value = !isFavorited.value
}

const WEEKDAY_NAMES = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']
</script>

<template>
  <!-- Top-level guard, not just the `page!` assertions below: when the createError(404) throw
       above rejects this component's async setup, Vue's Suspense still runs one render pass of
       this template with `page` at its pre-fetch value (undefined) before the rejection is
       handled. Without this v-if, that pass throws inside the render function itself (an
       unhandled rejection, not the createError) -- see blog/[slug].vue, which this mirrors. -->
  <div v-if="page" class="p-4 space-y-6">
    <StoriesRing
      v-if="stories.length"
      :stories="stories"
      :cover-photo="page.photos[0]?.url ?? null"
      :last-seen="storySeen"
      @open="viewerOpen = true"
    />

    <SalonGallery :photos="page.photos" />

    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-xl font-bold">{{ page.salon.name }}</h1>
        <p v-if="page.salon.tagline" data-testid="salon-tagline" class="text-sm opacity-70">{{ page.salon.tagline }}</p>
        <p class="text-sm">⭐ {{ Number(page.salon.ratingAvg).toFixed(1) }} ({{ page.salon.ratingCount }})</p>
        <p class="text-sm">{{ page.salon.address }}</p>
        <a
          v-if="page.salon.instagramHandle"
          :href="`https://instagram.com/${page.salon.instagramHandle}`"
          target="_blank"
          rel="noopener nofollow"
          data-testid="instagram-chip"
          class="mt-2 inline-flex items-center gap-1 rounded-full bg-(--color-surface-card) px-3 py-1 text-xs"
        >
          اینستاگرام <span dir="ltr" class="opacity-70">@{{ page.salon.instagramHandle }}</span>
        </a>
      </div>
      <button
        type="button"
        :disabled="favoriteBusy"
        class="rounded-full bg-(--color-surface-card) px-3 py-2 text-sm"
        @click="toggleFavorite"
      >
        {{ isFavorited ? '♥ ذخیره شده' : '♡ ذخیره' }}
      </button>
    </div>

    <section v-if="page.salon.about" data-testid="salon-about">
      <h2 class="font-bold mb-2">درباره سالن</h2>
      <!-- Plain text by design: interpolation only (never v-html), line breaks preserved. -->
      <p class="text-sm whitespace-pre-line">{{ page.salon.about }}</p>
    </section>

    <section>
      <h2 class="font-bold mb-2">خدمات</h2>
      <ul class="space-y-2">
        <li v-for="service in page.services" :key="service.id">
          <NuxtLink :to="`/booking/${slug}/${service.id}`" class="flex justify-between rounded-lg bg-(--color-surface-card) p-3 text-sm">
            <span>{{ service.name }} ({{ service.durationMin }} دقیقه)</span>
            <span class="font-bold text-(--color-accent)">{{ service.price.toLocaleString('fa-IR') }} تومان</span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <PortfolioGrid
      v-if="page.portfolio.length"
      :items="page.portfolio"
      :services="page.services"
      :slug="slug"
      :salon-id="page.salon.id"
      :can-report="canReport"
    />

    <section>
      <h2 class="font-bold mb-2">ساعات کاری</h2>
      <ul class="text-sm space-y-1">
        <li v-for="hour in page.hours" :key="hour.weekday">
          {{ WEEKDAY_NAMES[hour.weekday] }}: {{ hour.openTime.slice(0, 5) }} - {{ hour.closeTime.slice(0, 5) }}
        </li>
      </ul>
    </section>

    <SalonReviews :reviews="page.reviews" :can-report="canReport" @report="openReviewReport" />

    <button
      v-if="canReport"
      type="button"
      data-testid="report-salon-button"
      class="text-xs opacity-70 underline"
      @click="openSalonReport"
    >
      گزارش این سالن
    </button>

    <ReportForm v-if="reportOpen" :salon-id="page.salon.id" :review-id="reportReviewId" @close="closeReport" />

    <StoryViewer
      v-if="viewerOpen && stories.length"
      :stories="stories"
      :services="page.services"
      :slug="slug"
      :salon-id="page.salon.id"
      :can-report="canReport"
      @close="closeStoryViewer"
    />
  </div>
</template>
