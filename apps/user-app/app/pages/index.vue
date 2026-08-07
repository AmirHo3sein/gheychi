<script setup lang="ts">
import { iconForCategory } from '../utils/category-icon'
import { toSearchGender } from '../utils/gender-map'
import { geoJsonToLatLng } from '../utils/geo'
import type { SearchPage, SearchResult } from '../utils/types'
import type { SelectOption } from '../components/ui/AppSelect.client.vue'

interface IranCity { name: string; lat: number; lng: number }

const session = useSessionStore()
const { apiFetch } = useApi()

const categories = ref<{ id: number; name: string; icon: string }[]>([])
const salons = ref<SearchResult[]>([])
const selectedCategoryId = ref<number | null>(null)
const sort = ref<'distance' | 'rating'>('distance')
// Tehran as a hardcoded initial default -- the full city list now loads async from
// GET /cities, so this can't read the fetched list's first entry synchronously.
const coords = ref<{ lat: number; lng: number }>({ lat: 35.6892, lng: 51.389 })
const selectedCity = ref('تهران')
const cities = ref<IranCity[]>([])
const cityOptions = computed<SelectOption[]>(() => cities.value.map((c) => ({ value: c.name, label: c.name })))
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
  const { data, error } = await apiFetch<SearchPage>('/search', {
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
  // Only the first page is rendered today (hasMore/nextCursor are unused) -- identical
  // visible behavior to before this endpoint returned an envelope, since the default
  // page size (50) matches the old hard cap.
  salons.value = data?.items ?? []
  loading.value = false
}

// Selecting a city only updates the search coordinates; the coords watch below is the
// single place that actually re-runs the search, shared with the "near me" geolocation path.
watch(selectedCity, (name) => {
  const city = cities.value.find((c) => c.name === name)
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
  const [categoriesRes, citiesRes] = await Promise.all([
    apiFetch<typeof categories.value>('/categories'),
    apiFetch<IranCity[]>('/cities'),
  ])
  categories.value = categoriesRes.data ?? []
  cities.value = citiesRes.data ?? []
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

// The category row's own scrollbar is deliberately hidden (see the wrapper below), which
// removes the one signal a mouse-only desktop user has that there's more to see -- there's
// no touch drag, and a bare vertical mouse wheel doesn't scroll a horizontal row by default.
// These two buttons are the actual discoverable way to reach hidden pills; the edge fade
// mask is a secondary hint, not the only affordance, now.
const categoryScrollEl = useTemplateRef<HTMLDivElement>('categoryScrollEl')
const categoryAtStart = ref(true)
// Starts true (not false) so the "more" button doesn't flash visible for the brief window
// before GET /categories resolves and the row has anything to overflow with.
const categoryAtEnd = ref(true)

function updateCategoryScrollBoundaries() {
  const el = categoryScrollEl.value
  if (!el) return
  const maxScroll = el.scrollWidth - el.clientWidth
  // Browsers have historically disagreed on whether RTL scrollLeft counts up or down from
  // 0 -- current evergreen Chrome/Firefox/Safari all use the "negative" convention, but
  // abs() here means this boundary check stays correct even if that ever isn't true.
  const scrolled = Math.abs(el.scrollLeft)
  categoryAtStart.value = scrolled <= 2
  categoryAtEnd.value = scrolled >= maxScroll - 2
}

// dir 'more' reveals pills further along reading order (visually left, since this row is
// RTL); 'back' returns toward the already-visible start (visually right).
function scrollCategories(dir: 'more' | 'back') {
  const el = categoryScrollEl.value
  if (!el) return
  const amount = el.clientWidth * 0.75
  // Relies on the same "negative scrollLeft in RTL" convention noted above -- current
  // evergreen browsers agree on this, so 'more' moves scrollLeft further negative.
  el.scrollBy({ left: dir === 'more' ? -amount : amount, behavior: 'smooth' })
}

watch(categories, () => nextTick(updateCategoryScrollBoundaries))
onMounted(() => window.addEventListener('resize', updateCategoryScrollBoundaries))
onBeforeUnmount(() => window.removeEventListener('resize', updateCategoryScrollBoundaries))
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4 p-4 lg:max-w-5xl lg:p-6">
    <div class="flex items-center justify-between gap-3">
      <h1 class="text-xl font-bold text-(--color-text)">سالن‌های نزدیک شما</h1>
      <BaseButton variant="ghost" size="md" :loading="locating" @click="useMyLocation">
        <template #icon><BaseIcon name="map-pin" :size="16" /></template>
        نزدیک من
      </BaseButton>
    </div>

    <!-- The label moved onto AppSelect itself: as a bare sibling <label> it named nothing
         (a native `for` can't reach vue-multiselect's combobox div), so the field read as
         unlabelled to a screen reader. AppSelect associates it via aria-labelledby. -->
    <AppSelect v-model="selectedCity" label="شهر" :options="cityOptions" placeholder="شهر را انتخاب کنید" />

    <!-- snap-x + hidden native scrollbar: the row used to show a bare OS scrollbar with no
         scroll affordance beyond it. Snapping gives each pill a resting position instead of
         free-floating mid-scroll, and each pill's own category icon (service_categories.icon,
         previously unused here) makes the row scannable without reading every label.
         The two overlaid buttons are load-bearing, not decoration: hiding the scrollbar
         removed the only signal a mouse-only desktop user had that more pills exist off-
         screen (no touch drag, and a bare vertical wheel doesn't move a horizontal row) --
         without them, everything past the fold was genuinely unreachable by mouse. -->
    <div class="relative -mx-4 px-4" style="mask-image: linear-gradient(to left, transparent, black 24px, black calc(100% - 24px), transparent); -webkit-mask-image: linear-gradient(to left, transparent, black 24px, black calc(100% - 24px), transparent);">
      <div
        ref="categoryScrollEl"
        class="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="دسته‌بندی خدمات"
        @scroll="updateCategoryScrollBoundaries"
      >
        <button
          type="button"
          :aria-pressed="selectedCategoryId === null"
          class="min-h-9 shrink-0 snap-start whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors"
          :class="selectedCategoryId === null
            ? 'bg-(--color-accent-strong) text-(--color-fill-text)'
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
          class="flex min-h-9 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors"
          :class="selectedCategoryId === cat.id
            ? 'bg-(--color-accent-strong) text-(--color-fill-text)'
            : 'border border-(--color-border) bg-(--color-surface-card) text-(--color-text-muted) hover:text-(--color-text)'"
          @click="selectedCategoryId = cat.id"
        >
          <BaseIcon :name="iconForCategory(cat.icon)" :size="15" />
          {{ cat.name }}
        </button>
      </div>

      <button
        v-show="!categoryAtStart"
        type="button"
        aria-label="بازگشت به ابتدای دسته‌بندی‌ها"
        data-testid="categories-scroll-back"
        class="absolute start-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-(--color-border) bg-(--color-surface-card) text-(--color-text-muted) shadow-(--shadow-sm) transition-colors hover:text-(--color-text)"
        @click="scrollCategories('back')"
      >
        <BaseIcon name="chevron-forward" :size="16" />
      </button>
      <button
        v-show="!categoryAtEnd"
        type="button"
        aria-label="دیدن دسته‌بندی‌های بیشتر"
        data-testid="categories-scroll-more"
        class="absolute end-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-(--color-border) bg-(--color-surface-card) text-(--color-text-muted) shadow-(--shadow-sm) transition-colors hover:text-(--color-text)"
        @click="scrollCategories('more')"
      >
        <BaseIcon name="chevron-back" :size="16" />
      </button>
    </div>

    <!-- Neutral segmented controls, not accent-filled buttons: the selected category pill
         above is this screen's one accent-colored element (The One Seal Rule) -- the
         view/sort toggles are secondary filters, not the primary action, so their active
         state is a raised surface-card segment (shadow.sm + bold text) instead of a second
         accent fill. flex-wrap covers 320px, where both segmented groups together no longer
         fit one row. -->
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div class="inline-flex rounded-full bg-(--color-surface-subtle) p-1" role="group" aria-label="نوع نمایش">
        <button
          type="button"
          :aria-pressed="view === 'list'"
          class="min-h-8 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
          :class="view === 'list' ? 'bg-(--color-surface-card) font-semibold text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
          @click="view = 'list'"
        >
          لیست
        </button>
        <button
          type="button"
          :aria-pressed="view === 'map'"
          class="min-h-8 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
          :class="view === 'map' ? 'bg-(--color-surface-card) font-semibold text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
          @click="view = 'map'"
        >
          نقشه
        </button>
      </div>

      <div class="inline-flex rounded-full bg-(--color-surface-subtle) p-1 text-sm" role="group" aria-label="ترتیب نمایش">
        <button
          type="button"
          :aria-pressed="sort === 'distance'"
          class="min-h-8 rounded-full px-3.5 py-1.5 transition-colors"
          :class="sort === 'distance' ? 'bg-(--color-surface-card) font-semibold text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
          @click="sort = 'distance'"
        >
          نزدیک‌ترین
        </button>
        <button
          type="button"
          :aria-pressed="sort === 'rating'"
          class="min-h-8 rounded-full px-3.5 py-1.5 transition-colors"
          :class="sort === 'rating' ? 'bg-(--color-surface-card) font-semibold text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
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
      <BaseIcon name="user" :size="20" class="text-(--color-accent-text)" />
      <p class="text-sm text-(--color-text)">برای نمایش سالن‌های مناسب شما، ابتدا پروفایل خود را تکمیل کنید.</p>
      <NuxtLink
        to="/profile"
        class="inline-flex items-center justify-center rounded-xl bg-(--color-accent-strong) px-4 py-2.5 text-sm font-semibold text-(--color-fill-text) transition-colors hover:bg-(--color-accent-deep)"
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
        <!-- Single column stays the true default (mobile-primary per PRODUCT.md); sm/lg
             columns are a correctness pass for wider viewports, not a layout redesign --
             SalonCard's own horizontal thumb+text layout is unchanged. -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SalonCard v-for="salon in salons" :key="salon.id" :salon="salon" />
        </div>
      </template>
    </template>
  </div>
</template>
