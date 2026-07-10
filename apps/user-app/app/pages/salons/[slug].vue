<script setup lang="ts">
interface Salon {
  id: string
  name: string
  description: string | null
  address: string
  city: string
  ratingAvg: string
  ratingCount: number
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

  const [servicesRes, hoursRes, photosRes, reviewsRes] = await Promise.all([
    apiFetch<SalonServiceItem[]>(`/salons/${slug}/services`, { silent: true }),
    apiFetch<WorkingHourItem[]>(`/salons/${slug}/hours`, { silent: true }),
    apiFetch<PhotoItem[]>(`/salons/${slug}/photos`, { silent: true }),
    apiFetch<ReviewItem[]>(`/salons/${salonRes.data.id}/reviews`, { silent: true }),
  ])

  return {
    salon: salonRes.data,
    services: servicesRes.data ?? [],
    hours: hoursRes.data ?? [],
    photos: photosRes.data ?? [],
    reviews: reviewsRes.data ?? [],
  }
})

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Salon not found' })
}

useSeoMeta({
  title: page.value.salon.name,
  description: page.value.salon.description ?? `${page.value.salon.name} — ${page.value.salon.address}`,
  ogTitle: page.value.salon.name,
  ogImage: page.value.photos[0]?.url,
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
        address: { '@type': 'PostalAddress', streetAddress: page.value.salon.address, addressLocality: page.value.salon.city },
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

onMounted(async () => {
  if (!session.isLoggedIn) return
  const [favoritesRes, eligibilityRes] = await Promise.all([
    apiFetch<Salon[]>('/favorites', { silent: true }),
    apiFetch<{ canReport: boolean }>('/reports/eligibility', {
      query: { salonId: page.value!.salon.id },
      silent: true,
    }),
  ])
  isFavorited.value = !!favoritesRes.data?.some((s) => s.id === page.value!.salon.id)
  canReport.value = !!eligibilityRes.data?.canReport
})

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
  <div class="p-4 space-y-6">
    <SalonGallery :photos="page!.photos" />

    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-xl font-bold">{{ page!.salon.name }}</h1>
        <p class="text-sm">⭐ {{ Number(page!.salon.ratingAvg).toFixed(1) }} ({{ page!.salon.ratingCount }})</p>
        <p class="text-sm">{{ page!.salon.address }}</p>
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

    <section>
      <h2 class="font-bold mb-2">خدمات</h2>
      <ul class="space-y-2">
        <li v-for="service in page!.services" :key="service.id">
          <NuxtLink :to="`/booking/${slug}/${service.id}`" class="flex justify-between rounded-lg bg-(--color-surface-card) p-3 text-sm">
            <span>{{ service.name }} ({{ service.durationMin }} دقیقه)</span>
            <span class="font-bold text-(--color-accent)">{{ service.price.toLocaleString('fa-IR') }} تومان</span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section>
      <h2 class="font-bold mb-2">ساعات کاری</h2>
      <ul class="text-sm space-y-1">
        <li v-for="hour in page!.hours" :key="hour.weekday">
          {{ WEEKDAY_NAMES[hour.weekday] }}: {{ hour.openTime.slice(0, 5) }} - {{ hour.closeTime.slice(0, 5) }}
        </li>
      </ul>
    </section>

    <SalonReviews :reviews="page!.reviews" :can-report="canReport" @report="openReviewReport" />

    <button
      v-if="canReport"
      type="button"
      data-testid="report-salon-button"
      class="text-xs opacity-70 underline"
      @click="openSalonReport"
    >
      گزارش این سالن
    </button>

    <ReportForm v-if="reportOpen" :salon-id="page!.salon.id" :review-id="reportReviewId" @close="closeReport" />
  </div>
</template>
