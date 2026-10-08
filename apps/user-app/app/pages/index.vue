<script setup lang="ts">
import { iconForCategory } from '../utils/category-icon'
import { toSearchGender } from '../utils/gender-map'
import { geoJsonToLatLng } from '../utils/geo'
import { buildCanonicalUrl } from '../utils/canonical-url'
import type { SearchPage, SearchResult } from '../utils/types'
import type { SelectOption } from '../components/ui/AppSelect.client.vue'

interface IranCity { name: string; lat: number; lng: number }

// Same absolute-URL-from-request pattern as blog/[slug].vue's canonicalUrl -- og:image and
// og:url must be fully-qualified for social crawlers, and this page has no other source of
// the site's own origin to build them from.
const requestUrl = useRequestURL()
const homeDescription = 'با قیچی، نزدیک‌ترین سالن‌های زیبایی به خودت را پیدا می‌کنی و نوبتت را به‌صورت آنلاین رزرو می‌کنی.'
// brand-icon.png is the same logo asset AppHeader/login.vue already render as the site's
// identity elsewhere -- not a dedicated 1200x630 OG asset (none exists in public/ yet), so
// 'summary' (not 'summary_large_image') is the twitter card type that actually matches its
// 192x192 dimensions.
const homeImage = `${requestUrl.origin}/brand-icon.png`

useSeoMeta({
  title: 'رزرو آنلاین نوبت سالن‌های زیبایی نزدیک شما',
  description: homeDescription,
  ogTitle: 'قیچی — رزرو آنلاین نوبت سالن زیبایی',
  ogDescription: homeDescription,
  ogType: 'website',
  ogUrl: requestUrl.origin,
  ogImage: homeImage,
  twitterCard: 'summary',
})

// Built from the configured site url, NOT from useRequestURL() like og:url/og:image above --
// the difference is deliberate, not drift. og:url only has to name the page the sharer is
// looking at, whereas a canonical asserts which single url owns this content, and deriving
// THAT from the request lets every host/scheme/port variant confidently canonicalise to
// itself. See utils/canonical-url.ts.
const canonicalUrl = buildCanonicalUrl(useRuntimeConfig().public.siteUrl, '/')

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl }],
  script: [
    {
      type: 'application/ld+json',
      // The < escaping matters: stringify does NOT escape a closing script tag -- see the
      // same guard on salon/[slug].vue and blog/[slug].vue's own JSON-LD blocks.
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'قیچی',
        url: requestUrl.origin,
        description: homeDescription,
        inLanguage: 'fa-IR',
        publisher: {
          '@type': 'Organization',
          name: 'قیچی',
          logo: { '@type': 'ImageObject', url: homeImage },
        },
      }).replace(/[<]/g, '\\u003c'),
    },
  ],
})

const session = useSessionStore()
const { apiFetch } = useApi()
const { flags: featureFlags } = useFeatureFlags()

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

// A logged-in customer's results follow their own gender (mapped to /search's vocabulary).
// An anonymous visitor has none, and /search REQUIRES one -- the old answer was a login wall
// with no results at all, which hid the whole catalogue from first-time visitors and from
// crawlers. They now choose which kind of salon to browse (same default and choice /salons
// already offers without an account); login is only asked for when they actually book.
const anonGender = ref<'women' | 'men'>('women')
const searchGender = computed(() => (session.isLoggedIn ? toSearchGender(session.user?.gender) : anonGender.value))

// A logged-in account with no gender has no searchable request at all (auth.global.ts sends
// such a user to /profile before this page renders; this is the local guard for the same
// precondition, e.g. the value is cleared while this page is open).
const needsProfile = computed(() => session.isLoggedIn && !searchGender.value)

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
  // A search re-run while already in map view brings in salons whose coordinates were never
  // fetched -- the view watcher below only fires on the list→map flip, so without this the
  // fresh results would have no pins at all (the stale ones were already cleared).
  if (view.value === 'map') await loadCoordsForMap()
}

// Server-render the FIRST page of results (the default city + the visitor's gender) with the exact
// parameters the client would use. Fetching them only after hydration put the whole JS download,
// hydration and an API round trip in front of the page's largest paint (the first salon photo) -- ~5 s
// to LCP on a slow phone. Later filter/city/sort changes still go through loadSalons() below.
const initialSearch = await useAsyncData('home-initial-search', async () => {
  if (needsProfile.value) return null
  const { data, error } = await apiFetch<SearchPage>('/search', {
    query: { lat: coords.value.lat, lng: coords.value.lng, gender: searchGender.value, sort: sort.value },
    silent: true,
    // Never let a slow search hold the whole page render hostage: on timeout/error this resolves to null and
    // the client falls back to its own fetch after mount (the behaviour before the first page was server-rendered).
    timeoutMs: 3000,
  })
  return error ? null : (data ?? null)
})
const initialPage = initialSearch.data.value
if (initialPage) {
  salons.value = initialPage.items ?? []
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
  // The search only needs the default coordinates and gender, not the city/category lists, so it starts
  // WITH them instead of after them -- chaining it behind both added a full round trip before the first
  // salon (the page's largest paint) could even be requested.
  // Already server-rendered? Only the default query is, so there is nothing to fetch yet.
  const salonsLoaded = initialPage ? Promise.resolve() : loadSalons()
  const [categoriesRes, citiesRes] = await Promise.all([
    apiFetch<typeof categories.value>('/categories'),
    apiFetch<IranCity[]>('/cities'),
  ])
  categories.value = categoriesRes.data ?? []
  cities.value = citiesRes.data ?? []
  await salonsLoaded
})

watch([selectedCategoryId, sort, coords, anonGender], loadSalons, { deep: true })

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
  <div class="mx-auto max-w-2xl space-y-5 p-4 lg:max-w-5xl lg:p-6">
    <h1 class="text-xl font-bold text-(--color-text) lg:text-2xl">سالن‌های نزدیک شما</h1>

    <!-- Beauty Guide entry point. Only offered when the feature is on (the flag fails closed),
         and only for logged-in customers -- the guide page itself is private. A quiet tinted
         strip rather than a bordered card: it is a secondary path, and the page already has
         plenty of white boxes (DESIGN.md: no cards-on-cards). -->
    <NuxtLink
      v-if="featureFlags.beautyGuideEnabled && session.isLoggedIn"
      to="/beauty-guide"
      data-testid="beauty-guide-cta"
      class="flex items-center gap-3 rounded-2xl bg-(--color-accent-soft) px-4 py-3.5 transition-colors hover:bg-(--color-surface-subtle) active:scale-[0.99] motion-reduce:active:scale-100"
    >
      <BaseIcon name="sparkles" :size="22" class="shrink-0 text-(--color-ai)" />
      <span class="min-w-0 flex-1">
        <span class="block font-bold text-(--color-text)">این استایل را پیدا کن</span>
        <span class="block text-xs leading-5 text-(--color-text-muted)">عکس استایل دلخواهت را بفرست؛ می‌گوییم اسمش چیست و کدام سالن‌ها انجامش می‌دهند.</span>
      </span>
      <BaseIcon name="chevron-back" :size="18" class="shrink-0 text-(--color-text-muted)" />
    </NuxtLink>

    <!-- City picker and "near me" share one row: both answer "where?", and on a phone they used
         to cost two full-width rows. The label moved onto AppSelect itself (kept for screen
         readers, not drawn): as a bare sibling <label> it named nothing -- a native `for`
         can't reach vue-multiselect's combobox div -- so the field read as unlabelled.
         AppSelect associates it via aria-labelledby. -->
    <div class="flex items-center gap-2">
      <AppSelect v-model="selectedCity" class="min-w-0 flex-1" label="شهر" hide-label :options="cityOptions" placeholder="شهر را انتخاب کنید" />
      <BaseButton variant="secondary" size="md" :loading="locating" class="shrink-0" @click="useMyLocation">
        <template #icon><BaseIcon name="map-pin" :size="16" /></template>
        نزدیک من
      </BaseButton>
    </div>

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
          class="min-h-10 shrink-0 snap-start whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors"
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
          class="flex min-h-10 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors"
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
        class="absolute start-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-(--color-border) bg-(--color-surface-card) text-(--color-text-muted) shadow-(--shadow-sm) transition-colors hover:text-(--color-text)"
        @click="scrollCategories('back')"
      >
        <BaseIcon name="chevron-forward" :size="16" />
      </button>
      <button
        v-show="!categoryAtEnd"
        type="button"
        aria-label="دیدن دسته‌بندی‌های بیشتر"
        data-testid="categories-scroll-more"
        class="absolute end-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-(--color-border) bg-(--color-surface-card) text-(--color-text-muted) shadow-(--shadow-sm) transition-colors hover:text-(--color-text)"
        @click="scrollCategories('more')"
      >
        <BaseIcon name="chevron-back" :size="16" />
      </button>
    </div>

    <!-- Neutral segmented controls, not accent-filled buttons: the selected category pill
         above is this screen's one accent-colored element (The One Seal Rule) -- the
         view/sort toggles are secondary filters, not the primary action, so their active
         state is a raised surface-card segment (shadow.sm + bold text) instead of a second
         accent fill. flex-wrap covers 320px, where the groups together no longer fit one
         row. An anonymous visitor additionally chooses women's/men's salons (a logged-in
         customer's results follow their profile, so the choice is not offered to them). -->
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div
        v-if="!session.isLoggedIn"
        class="inline-flex rounded-full bg-(--color-surface-subtle) p-1"
        role="group"
        aria-label="نوع سالن"
        data-testid="anon-gender"
      >
        <button
          type="button"
          :aria-pressed="anonGender === 'women'"
          class="min-h-9 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
          :class="anonGender === 'women' ? 'bg-(--color-surface-card) font-semibold text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
          @click="anonGender = 'women'"
        >
          بانوان
        </button>
        <button
          type="button"
          :aria-pressed="anonGender === 'men'"
          class="min-h-9 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
          :class="anonGender === 'men' ? 'bg-(--color-surface-card) font-semibold text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
          @click="anonGender = 'men'"
        >
          آقایان
        </button>
      </div>

      <div class="inline-flex rounded-full bg-(--color-surface-subtle) p-1" role="group" aria-label="نوع نمایش">
        <button
          type="button"
          :aria-pressed="view === 'list'"
          class="min-h-9 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
          :class="view === 'list' ? 'bg-(--color-surface-card) font-semibold text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
          @click="view = 'list'"
        >
          لیست
        </button>
        <button
          type="button"
          :aria-pressed="view === 'map'"
          class="min-h-9 rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
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
          class="min-h-9 rounded-full px-3.5 py-1.5 transition-colors"
          :class="sort === 'distance' ? 'bg-(--color-surface-card) font-semibold text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
          @click="sort = 'distance'"
        >
          نزدیک‌ترین
        </button>
        <button
          type="button"
          :aria-pressed="sort === 'rating'"
          class="min-h-9 rounded-full px-3.5 py-1.5 transition-colors"
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
        class="inline-flex min-h-11 items-center justify-center rounded-xl bg-(--color-accent-strong) px-4 text-sm font-semibold text-(--color-fill-text) transition-colors hover:bg-(--color-accent-deep)"
      >
        تکمیل پروفایل
      </NuxtLink>
    </div>
    <template v-else>
      <!-- Loading/error sit ABOVE the view switch, so both views get them: they used to be
           nested inside the list branch only, leaving map view with no feedback at all
           while a city change re-ran the search (or failed). The map itself stays mounted
           through a reload rather than being torn down and re-created around the loading
           state -- SalonMap's own prop watchers refresh its pins in place. The list view
           shows card-shaped skeletons so the grid doesn't jump when results land. -->
      <div v-if="loading" role="status" data-testid="salons-loading">
        <span class="sr-only">در حال بارگذاری...</span>
        <div v-if="view === 'list'" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          <div v-for="n in 3" :key="n" class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-2.5">
            <div class="skeleton aspect-[4/3] rounded-xl" />
            <div class="space-y-2 px-1.5 pt-3 pb-2">
              <div class="skeleton h-4 w-2/3 rounded" />
              <div class="skeleton h-3 w-1/3 rounded" />
              <div class="skeleton h-3 w-1/2 rounded" />
            </div>
          </div>
        </div>
      </div>
      <div v-else-if="searchError" role="alert" class="flex flex-col items-center gap-3 rounded-2xl border border-(--color-danger-soft) bg-(--color-danger-soft) p-6 text-center">
        <BaseIcon name="alert-circle" :size="20" class="text-(--color-danger)" />
        <p class="text-sm text-(--color-text)">مشکلی در بارگذاری سالن‌ها پیش آمد.</p>
        <BaseButton variant="secondary" size="md" @click="loadSalons">تلاش دوباره</BaseButton>
      </div>
      <LazySalonMap v-if="view === 'map' && !searchError" :salons="salons" :center="coords" :salon-coords="salonCoords" />
      <template v-else-if="view === 'list' && !loading && !searchError">
        <div v-if="!salons.length" data-testid="salons-empty" class="flex flex-col items-center gap-2 py-10 text-center">
          <BaseIcon name="search" :size="28" class="text-(--color-text-muted) opacity-60" />
          <p class="font-medium text-(--color-text)">سالنی در این منطقه پیدا نشد</p>
          <p class="max-w-xs text-sm text-(--color-text-muted)">شهر دیگری را امتحان کنید یا دسته‌بندی را روی «همه» بگذارید.</p>
          <BaseButton v-if="selectedCategoryId !== null" variant="secondary" size="md" @click="selectedCategoryId = null">نمایش همه دسته‌ها</BaseButton>
        </div>
        <template v-else>
          <h2 class="sr-only">نتایج جستجو</h2>
          <!-- Single column stays the true default (mobile-primary per PRODUCT.md); the card is
               image-first, so two columns from `sm` keeps each photo a useful size. -->
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SalonCard v-for="(salon, i) in salons" :key="salon.id" :salon="salon" :heading-level="3" :priority="i === 0" />
          </div>
        </template>
      </template>
    </template>

    <!-- Rendered unconditionally (not behind the results): the results list is client-loaded, so
         this link is the only salon-discovery path in the server-rendered html a crawler
         receives for '/'. Without it the home page emits zero internal links toward any salon,
         leaving the sitemap as the sole entry channel into /salons/:slug. It sits below the
         results rather than above them: it is a "see everything" door, not a first action. -->
    <p class="pt-2 text-center text-sm">
      <NuxtLink to="/salons" class="inline-flex min-h-11 items-center gap-1 font-medium text-(--color-accent-text) hover:underline">
        مرور همه سالن‌های زیبایی بر اساس شهر
        <BaseIcon name="chevron-back" :size="14" />
      </NuxtLink>
    </p>
  </div>
</template>
