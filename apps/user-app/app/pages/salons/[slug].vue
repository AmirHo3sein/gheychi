<script setup lang="ts">
import type { SalonPortfolioItem, SalonStoryItem } from '../../utils/types'
import { resolveSalonDescription } from '../../utils/salon-seo'
import { readStorySeen } from '../../utils/story-seen'
import { applyDiscount } from '../../utils/discount'
import { geoJsonToLatLng } from '../../utils/geo'

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
  location: { type: 'Point'; coordinates: [number, number] }
}
interface SalonServiceItem { id: string; name: string; description: string | null; price: number; durationMin: number; discountPercent: number | null }
interface WorkingHourItem { weekday: number; openTime: string; closeTime: string }
interface PhotoItem { id: string; url: string }
interface ReviewItem { id: string; rating: number; comment: string | null; salonReply: string | null; createdAt: string }
interface ReviewsPage { items: ReviewItem[]; total: number; page: number; pageSize: number }
interface WorkerItem { id: string; name: string; ratingAvg: string | number; ratingCount: number }
// Mirrors booking/[slug]/[serviceId].vue's local interface -- kept in sync with that
// page's shape rather than shared, matching this codebase's per-file DTO convention.
interface BookingTerms { depositPercent: number; depositMinToman: number; cancellationWindowHours: number }

const route = useRoute()
const slug = route.params.slug as string
const { apiFetch } = useApi()
const session = useSessionStore()

const { data: page } = await useAsyncData(`salon-${slug}`, async () => {
  const salonRes = await apiFetch<Salon>(`/salons/${slug}`, { silent: true })
  if (!salonRes.data) return null

  const [servicesRes, hoursRes, photosRes, reviewsRes, portfolioRes, workersRes, termsRes] = await Promise.all([
    apiFetch<SalonServiceItem[]>(`/salons/${slug}/services`, { silent: true }),
    apiFetch<WorkingHourItem[]>(`/salons/${slug}/hours`, { silent: true }),
    apiFetch<PhotoItem[]>(`/salons/${slug}/photos`, { silent: true }),
    apiFetch<ReviewsPage>(`/salons/${salonRes.data.id}/reviews`, { silent: true }),
    apiFetch<SalonPortfolioItem[]>(`/salons/${slug}/portfolio`, { silent: true }),
    apiFetch<WorkerItem[]>(`/salons/${slug}/workers`, { silent: true }),
    apiFetch<BookingTerms>('/platform-config/booking-terms', { silent: true }),
  ])

  return {
    salon: salonRes.data,
    services: servicesRes.data ?? [],
    hours: hoursRes.data ?? [],
    photos: photosRes.data ?? [],
    // Only the first page is rendered today, matching search's own precedent -- the
    // default page size (50) matches the old hard cap so this is invisible for the
    // overwhelming majority of salons.
    reviews: reviewsRes.data?.items ?? [],
    portfolio: portfolioRes.data ?? [],
    workers: workersRes.data ?? [],
    terms: termsRes.data,
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

// A single-item shape for SalonMap.client.vue, which is built for the multi-salon search
// map (index.vue) -- distanceKm isn't meaningful on a single salon's own profile and is
// unused by the component's marker/popup logic, so a placeholder value satisfies its prop
// type without touching that component for a value it never reads.
const salonMapData = computed(() => {
  const coords = geoJsonToLatLng(page.value!.salon.location.coordinates)
  return {
    salons: [{ id: page.value!.salon.id, name: page.value!.salon.name, slug, distanceKm: 0 }],
    center: coords,
    salonCoords: { [page.value!.salon.id]: coords },
  }
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

// Weekday 0 = یکشنبه, matching the API's `working_hours.weekday` (JS Date.getDay()) -- a
// lookup table by stored int, not a display order.
const WEEKDAY_NAMES = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']
// Iran's week starts Saturday, not Sunday -- separate, display-only ordering so the stored
// numbering above never has to change. page.hours may not include every weekday (a salon can
// leave a day unset), so this sorts by each row's own position in this order rather than
// assuming a complete/dense 0-6 array.
const WEEKDAY_DISPLAY_ORDER = [6, 0, 1, 2, 3, 4, 5]
const orderedHours = computed(() =>
  [...(page.value?.hours ?? [])].sort(
    (a, b) => WEEKDAY_DISPLAY_ORDER.indexOf(a.weekday) - WEEKDAY_DISPLAY_ORDER.indexOf(b.weekday),
  ),
)
</script>

<template>
  <!-- Top-level guard, not just the `page!` assertions below: when the createError(404) throw
       above rejects this component's async setup, Vue's Suspense still runs one render pass of
       this template with `page` at its pre-fetch value (undefined) before the rejection is
       handled. Without this v-if, that pass throws inside the render function itself (an
       unhandled rejection, not the createError) -- see blog/[slug].vue, which this mirrors. -->
  <div v-if="page" class="mx-auto max-w-2xl space-y-6 p-4">
    <StoriesRing
      v-if="stories.length"
      :stories="stories"
      :cover-photo="page.photos[0]?.url ?? null"
      :last-seen="storySeen"
      @open="viewerOpen = true"
    />

    <SalonGallery :photos="page.photos" />

    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <!-- break-words, not just the wrapper's min-w-0: a provider-authored salon name
               can be one long unbreakable token, and min-w-0 only lets the BOX shrink --
               the text inside it still overflows unless it is allowed to break. -->
          <h1 class="text-xl font-bold break-words text-(--color-text)">{{ page.salon.name }}</h1>
          <!-- This page only ever renders an approved salon (the API's findPublicBySlug
               gates on status:'approved'), so this badge makes an already-true fact
               visible rather than asserting a new check. The one accent-colored element
               on this page (One Seal Rule) -- prices below are deliberately neutral.
               Text is --color-text, not accent: plain --color-accent on accent-soft measured
               2.64:1 (light) / 2.73:1 (dark), both failing WCAG AA -- --color-text passes with
               a large margin in both modes (same fix already applied on profile.vue/bookings
               for the equivalent accent-soft-background pattern). The icon stays accent-strong
               for the background-tint's remaining accent signal; it does not fully clear the
               non-text 3:1 threshold in dark mode against this specific soft background, a
               smaller residual gap left for a follow-up token pass rather than blocking this. -->
          <span
            data-testid="salon-verified-badge"
            class="inline-flex items-center gap-1 rounded-full bg-(--color-accent-soft) px-2 py-1 text-xs font-bold text-(--color-text)"
          >
            <BaseIcon name="shield" :size="14" class="text-(--color-accent-text)" />
            سالن تایید شده
          </span>
        </div>
        <p v-if="page.salon.tagline" data-testid="salon-tagline" class="mt-1 text-sm text-(--color-text-muted)">{{ page.salon.tagline }}</p>
        <p class="mt-1 flex items-center gap-1 text-sm text-(--color-text-muted)">
          <BaseIcon name="star" :size="14" />
          {{ Number(page.salon.ratingAvg).toFixed(1) }} ({{ page.salon.ratingCount }})
        </p>
        <!-- items-start, unlike the single-line rating row above it: at 320px the name
             column is ~176px wide and a Persian street address wraps to three lines, which
             `items-center` would leave the pin floating against the middle of. Same
             icon-nudge idiom as the deposit note further down. -->
        <p class="mt-1 flex items-start gap-1 text-sm text-(--color-text-muted)">
          <BaseIcon name="map-pin" :size="14" class="mt-0.5 shrink-0" />
          {{ page.salon.address }}
        </p>
        <a
          v-if="page.salon.instagramHandle"
          :href="`https://instagram.com/${page.salon.instagramHandle}`"
          target="_blank"
          rel="noopener nofollow"
          data-testid="instagram-chip"
          class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-(--color-border) bg-(--color-surface-card) px-3 py-3.5 text-xs text-(--color-text) transition-colors hover:bg-(--color-surface-subtle)"
        >
          <BaseIcon name="instagram" :size="14" />
          اینستاگرام <span dir="ltr" class="text-(--color-text-muted)">@{{ page.salon.instagramHandle }}</span>
        </a>
      </div>
      <button
        type="button"
        :disabled="favoriteBusy"
        :aria-pressed="isFavorited"
        data-testid="favorite-button"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-3 text-sm font-medium transition-colors disabled:opacity-60"
        :class="isFavorited
          ? 'bg-(--color-danger-soft) text-(--color-danger)'
          : 'border border-(--color-border) bg-(--color-surface-card) text-(--color-text-muted) hover:text-(--color-text)'"
        @click="toggleFavorite"
      >
        <BaseIcon name="heart" :size="16" />
        {{ isFavorited ? 'ذخیره شده' : 'ذخیره' }}
      </button>
    </div>

    <LazySalonMap
      data-testid="salon-map"
      :salons="salonMapData.salons"
      :center="salonMapData.center"
      :salon-coords="salonMapData.salonCoords"
    />

    <section v-if="page.salon.about" data-testid="salon-about">
      <h2 class="mb-2 text-xl font-bold text-(--color-text)">درباره سالن</h2>
      <!-- Plain text by design: interpolation only (never v-html), line breaks preserved. -->
      <p class="text-sm whitespace-pre-line">{{ page.salon.about }}</p>
    </section>

    <section>
      <h2 class="mb-2 text-xl font-bold text-(--color-text)">خدمات</h2>
      <p class="mb-3 flex items-start gap-1.5 text-xs text-(--color-text-muted)">
        <BaseIcon name="shield" :size="14" class="mt-0.5 shrink-0" />
        <span v-if="page.terms">
          برای تضمین نوبت، پیش‌پرداخت آنلاین معادل ٪{{ page.terms.depositPercent.toLocaleString('fa-IR') }} مبلغ خدمت
          (حداقل {{ page.terms.depositMinToman.toLocaleString('fa-IR') }} تومان) دریافت می‌شود.
        </span>
        <span v-else>برای تضمین نوبت، پیش‌پرداخت آنلاین دریافت می‌شود.</span>
      </p>
      <ul v-if="page.services.length" class="space-y-2">
        <li v-for="service in page.services" :key="service.id">
          <NuxtLink
            :to="`/booking/${slug}/${service.id}`"
            class="block rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-4 text-sm shadow-(--shadow-sm) transition-shadow hover:shadow-(--shadow-md)"
          >
            <!-- Same shape as the booking page's price row, and for the same reason: at
                 320px a provider-authored service name, a discount badge and a
                 seven-figure price do not fit one 254px line. The name is allowed to
                 break (it is the only genuinely elastic part), while the badge and each
                 price stay whole and wrap as units. -->
            <div class="flex items-center justify-between gap-3">
              <span class="min-w-0 break-words text-(--color-text)">{{ service.name }} ({{ service.durationMin }} دقیقه)</span>
              <span class="flex flex-wrap items-center justify-end gap-2">
                <span
                  v-if="service.discountPercent"
                  class="whitespace-nowrap rounded-full bg-(--color-danger-soft) px-2 py-0.5 text-xs font-bold text-(--color-danger)"
                >
                  ٪{{ service.discountPercent.toLocaleString('fa-IR') }} تخفیف
                </span>
                <span class="flex flex-col items-end whitespace-nowrap leading-tight">
                  <span v-if="service.discountPercent" class="text-xs text-(--color-text-muted) line-through">
                    {{ service.price.toLocaleString('fa-IR') }} تومان
                  </span>
                  <span class="font-bold text-(--color-text)">
                    {{ applyDiscount(service.price, service.discountPercent).toLocaleString('fa-IR') }} تومان
                  </span>
                </span>
              </span>
            </div>
            <!-- Provider-authored note on the listed duration (e.g. "may take longer") --
                 the duration above is a minimum, not a guarantee, and this is where a salon
                 says so explicitly instead of a customer being surprised mid-appointment. -->
            <p v-if="service.description" class="mt-1.5 text-xs text-(--color-text-muted)">{{ service.description }}</p>
          </NuxtLink>
        </li>
      </ul>
      <p
        v-else
        data-testid="services-empty"
        class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-6 text-center text-sm text-(--color-text-muted)"
      >
        در حال حاضر خدمتی برای رزرو ثبت نشده است
      </p>
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
      <h2 class="mb-2 text-xl font-bold text-(--color-text)">ساعات کاری</h2>
      <ul v-if="page.hours.length" data-testid="hours-list" class="text-sm space-y-1 text-(--color-text)">
        <li v-for="hour in orderedHours" :key="hour.weekday">
          {{ WEEKDAY_NAMES[hour.weekday] }}: {{ hour.openTime.slice(0, 5) }} - {{ hour.closeTime.slice(0, 5) }}
        </li>
      </ul>
      <p v-else data-testid="hours-empty" class="text-sm text-(--color-text-muted)">ساعات کاری ثبت نشده است</p>
    </section>

    <SalonTeam :workers="page.workers" />

    <SalonReviews :reviews="page.reviews" :can-report="canReport" @report="openReviewReport" />

    <button
      v-if="canReport"
      type="button"
      data-testid="report-salon-button"
      class="inline-flex min-h-11 items-center text-xs opacity-70 underline"
      @click="openSalonReport"
    >
      گزارش این سالن
    </button>

    <ReportForm v-if="reportOpen" :salon-id="page.salon.id" :review-id="reportReviewId" @close="closeReport" />

    <LazyStoryViewer
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
