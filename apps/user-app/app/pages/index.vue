<script setup lang="ts">
import { CITY_CENTERS } from '../utils/city-centers'
import { toSearchGender } from '../utils/gender-map'
import { geoJsonToLatLng } from '../utils/geo'
import type { SearchResult } from '../utils/types'

const session = useSessionStore()
const { apiFetch } = useApi()

const categories = ref<{ id: number; name: string; icon: string }[]>([])
const salons = ref<SearchResult[]>([])
const selectedCategoryId = ref<number | null>(null)
const sort = ref<'distance' | 'rating'>('distance')
const coords = ref<{ lat: number; lng: number }>({ lat: CITY_CENTERS[0]!.lat, lng: CITY_CENTERS[0]!.lng })
const selectedCity = ref(CITY_CENTERS[0]!.name)
const loading = ref(true)
const searchError = ref(false)
const locating = ref(false)
const view = ref<'list' | 'map'>('list')
const salonCoords = ref<Record<string, { lat: number; lng: number }>>({})

const searchGender = computed(() => toSearchGender(session.user?.gender))

// /search's `gender` param is REQUIRED, so with no gender on the account there is no valid
// request to make: ofetch drops the undefined param and the API 400s, which used to land on
// the generic "something went wrong" card whose retry button could only ever fail again.
// auth.global.ts sends such a user to /profile before this page renders; this is the local
// guard for the same precondition (e.g. the value is cleared while this page is open).
const needsProfile = computed(() => !searchGender.value)

let requestSeq = 0

async function loadSalons() {
  if (needsProfile.value) {
    salons.value = []
    searchError.value = false
    loading.value = false
    return
  }
  const seq = ++requestSeq
  loading.value = true
  searchError.value = false
  const { data, error } = await apiFetch<SearchResult[]>('/search', {
    query: {
      lat: coords.value.lat,
      lng: coords.value.lng,
      gender: searchGender.value,
      categoryId: selectedCategoryId.value ?? undefined,
      sort: sort.value,
    },
    silent: true,
  })
  // A slower, now-superseded request landing after a newer one -- discard it so a fast
  // double-tap on filters can never let a stale response overwrite a fresher result.
  if (seq !== requestSeq) return
  if (error) {
    searchError.value = true
    salons.value = []
    loading.value = false
    return
  }
  salons.value = data ?? []
  loading.value = false
}

// Selecting a city only updates the search coordinates; the coords watch below is the
// single place that actually re-runs the search, shared with the "near me" geolocation path.
watch(selectedCity, (name) => {
  const city = CITY_CENTERS.find((c) => c.name === name)
  if (city) coords.value = { lat: city.lat, lng: city.lng }
})

function useMyLocation() {
  if (!import.meta.client || !navigator.geolocation) return
  locating.value = true
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      coords.value = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      locating.value = false
    },
    () => {
      // Denied or unavailable -- silently stay on the already-selected city, no error UI
      // needed for a purely optional convenience action.
      locating.value = false
    },
    { timeout: 5000 },
  )
}

onMounted(async () => {
  const { data } = await apiFetch<typeof categories.value>('/categories')
  categories.value = data ?? []
  await loadSalons()
})

watch([selectedCategoryId, sort, coords], loadSalons, { deep: true })

async function loadCoordsForMap() {
  const missing = salons.value.filter((s) => !salonCoords.value[s.id])
  // N+1-shaped: one request per visible salon. Accepted tradeoff at today's scale
  // (a handful of search results per page) -- revisit (e.g. a batched endpoint) if
  // result-set sizes grow.
  const results = await Promise.all(
    missing.map((s) => apiFetch<{ location: { coordinates: [number, number] } }>(`/salons/${s.slug}`, { silent: true })),
  )
  for (let i = 0; i < missing.length; i++) {
    const data = results[i]!.data
    if (data) salonCoords.value[missing[i]!.id] = geoJsonToLatLng(data.location.coordinates)
  }
}

watch(view, (v) => {
  if (v === 'map') loadCoordsForMap()
})
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4 p-4">
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-xl font-bold text-(--color-text)">سالن‌های نزدیک شما</h1>
      <BaseButton variant="ghost" size="md" :loading="locating" @click="useMyLocation">
        <template #icon><BaseIcon name="map-pin" :size="16" /></template>
        نزدیک من
      </BaseButton>
    </div>

    <BaseSelect v-model="selectedCity" label="شهر">
      <option v-for="city in CITY_CENTERS" :key="city.name" :value="city.name">{{ city.name }}</option>
    </BaseSelect>

    <div class="relative -mx-4 px-4" style="mask-image: linear-gradient(to left, transparent, black 24px, black calc(100% - 24px), transparent); -webkit-mask-image: linear-gradient(to left, transparent, black 24px, black calc(100% - 24px), transparent);">
      <div class="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="دسته‌بندی خدمات">
        <button
          type="button"
          :aria-pressed="selectedCategoryId === null"
          class="min-h-9 shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors"
          :class="selectedCategoryId === null
            ? 'bg-(--color-accent-strong) text-white'
            : 'border border-(--color-border) bg-(--color-surface-card) text-(--color-text-muted) hover:text-(--color-text)'"
          @click="selectedCategoryId = null"
        >
          همه
        </button>
        <button
          v-for="cat in categories"
          :key="cat.id"
          type="button"
          :aria-pressed="selectedCategoryId === cat.id"
          class="min-h-9 shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors"
          :class="selectedCategoryId === cat.id
            ? 'bg-(--color-accent-strong) text-white'
            : 'border border-(--color-border) bg-(--color-surface-card) text-(--color-text-muted) hover:text-(--color-text)'"
          @click="selectedCategoryId = cat.id"
        >
          {{ cat.name }}
        </button>
      </div>
    </div>

    <!-- flex-wrap: at 320px the two view chips (~132px, neither label breakable) plus the
         two sort buttons (~152px at their smallest, "نزدیک‌ترین" is one unbreakable word
         thanks to its ZWNJ) exceed the 288px content box. Wrapping puts the sort pair on
         its own row there and keeps a single row from ~360px up. -->
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div class="flex gap-2" role="group" aria-label="نوع نمایش">
        <button
          type="button"
          :aria-pressed="view === 'list'"
          class="min-h-9 rounded-full px-4 py-2 text-sm font-medium transition-colors"
          :class="view === 'list' ? 'bg-(--color-accent-strong) text-white' : 'border border-(--color-border) bg-(--color-surface-card) text-(--color-text-muted) hover:text-(--color-text)'"
          @click="view = 'list'"
        >
          لیست
        </button>
        <button
          type="button"
          :aria-pressed="view === 'map'"
          class="min-h-9 rounded-full px-4 py-2 text-sm font-medium transition-colors"
          :class="view === 'map' ? 'bg-(--color-accent-strong) text-white' : 'border border-(--color-border) bg-(--color-surface-card) text-(--color-text-muted) hover:text-(--color-text)'"
          @click="view = 'map'"
        >
          نقشه
        </button>
      </div>

      <div class="flex gap-1 text-sm" role="group" aria-label="ترتیب نمایش">
        <button
          type="button"
          :aria-pressed="sort === 'distance'"
          class="rounded-lg px-2 py-1 transition-colors"
          :class="sort === 'distance' ? 'text-(--color-accent-strong) font-semibold' : 'text-(--color-text-muted) hover:text-(--color-text)'"
          @click="sort = 'distance'"
        >
          نزدیک‌ترین
        </button>
        <span class="text-(--color-border)">·</span>
        <button
          type="button"
          :aria-pressed="sort === 'rating'"
          class="rounded-lg px-2 py-1 transition-colors"
          :class="sort === 'rating' ? 'text-(--color-accent-strong) font-semibold' : 'text-(--color-text-muted) hover:text-(--color-text)'"
          @click="sort = 'rating'"
        >
          بهترین امتیاز
        </button>
      </div>
    </div>

    <!-- No gender on the account means no searchable request exists at all, so say what's
         missing and where to fix it instead of showing an error the user can't act on. -->
    <div
      v-if="needsProfile"
      data-testid="needs-profile"
      role="status"
      class="flex flex-col items-center gap-3 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-6 text-center"
    >
      <BaseIcon name="user" :size="20" class="text-(--color-accent)" />
      <p class="text-sm text-(--color-text)">برای نمایش سالن‌های مناسب شما، ابتدا پروفایل خود را تکمیل کنید.</p>
      <NuxtLink
        to="/profile"
        class="inline-flex items-center justify-center rounded-xl bg-(--color-accent-strong) px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-(--color-accent-deep)"
      >
        تکمیل پروفایل
      </NuxtLink>
    </div>
    <LazySalonMap v-else-if="view === 'map'" :salons="salons" :center="coords" :salon-coords="salonCoords" />
    <template v-else>
      <p v-if="loading" role="status" class="py-8 text-center text-sm text-(--color-text-muted)">در حال بارگذاری...</p>
      <div v-else-if="searchError" role="alert" class="flex flex-col items-center gap-3 rounded-2xl border border-(--color-danger-soft) bg-(--color-danger-soft) p-6 text-center">
        <BaseIcon name="alert-circle" :size="20" class="text-(--color-danger)" />
        <p class="text-sm text-(--color-text)">مشکلی در بارگذاری سالن‌ها پیش آمد.</p>
        <BaseButton variant="secondary" size="md" @click="loadSalons">تلاش دوباره</BaseButton>
      </div>
      <p v-else-if="!salons.length" class="py-8 text-center text-sm text-(--color-text-muted)">سالنی در این منطقه پیدا نشد</p>
      <template v-else>
        <h2 class="sr-only">نتایج جستجو</h2>
        <div class="space-y-3">
          <SalonCard v-for="salon in salons" :key="salon.id" :salon="salon" />
        </div>
      </template>
    </template>
  </div>
</template>
