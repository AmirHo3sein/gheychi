<script setup lang="ts">
import type { SalonPortfolioItem, SalonStoryItem } from '../../utils/types'
import { buildBookingLink, resolveAttributionSource, type AttributionSource } from '../../utils/attribution'
import { resolveSalonDescription } from '../../utils/salon-seo'
import { readStorySeen } from '../../utils/story-seen'
import { applyDiscount } from '../../utils/discount'
import { geoJsonToLatLng } from '../../utils/geo'
import { formatToman } from '../../utils/format-toman'
import { toPersianDigits } from '../../utils/digits'
import { formatContactPhone } from '../../utils/contact-phone'
import { formatMemberSince } from '../../utils/member-since'
import { googleMapsUrl, neshanUrl } from '../../utils/map-links'

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
  // Both added by the trust & launch-readiness API: absent on an older API, null when the salon
  // gave no contact number.
  contactPhone?: string | null
  memberSince?: string | null
}
type PricingType = 'fixed' | 'from' | 'range' | 'quote'
interface SalonServiceItem {
  id: string
  name: string
  description: string | null
  pricingType: PricingType
  price: number | null
  priceMax: number | null
  durationMin: number
  durationMax: number | null
  discountPercent: number | null
  // Optional primary photo (POST /salons/mine/services/:id/image). Optional in the type too so
  // an older API without the field reads as "no image" rather than breaking the list.
  imageUrl?: string | null
}
// Catalog/display only -- a package is never itself booked; each item links through to its
// OWN existing single-service booking flow (see public-salon-content.controller.ts's own
// doc comment on GET /salons/:slug/packages).
interface SalonPackageItem { serviceId: string; name: string; pricingType: PricingType; price: number | null; durationMin: number }
interface SalonPackage {
  id: string
  name: string
  description: string | null
  pricingType: PricingType
  price: number | null
  priceMax: number | null
  items: SalonPackageItem[]
}
interface WorkingHourItem { weekday: number; openTime: string; closeTime: string }
// Both times null = closed all day; both set = closed only during [startTime, endTime) on
// `date` -- mirrors ScheduleException's own shape (schedule-exception.entity.ts), minus the
// internal isClosed flag the public endpoint doesn't expose (every row here is one).
interface SalonExceptionItem { date: string; startTime: string | null; endTime: string | null; reason: string | null }
interface PhotoItem { id: string; url: string }
interface ReviewItem { id: string; rating: number; comment: string | null; salonReply: string | null; createdAt: string }
interface ReviewsPage { items: ReviewItem[]; total: number; page: number; pageSize: number }
interface WorkerItem { id: string; name: string; ratingAvg: string | number; ratingCount: number }
// Mirrors booking/[slug]/[serviceId].vue's local interface -- kept in sync with that
// page's shape rather than shared, matching this codebase's per-file DTO convention.
interface BookingTerms { depositPercent: number; depositMinToman: number; cancellationWindowHours: number }

// Small enough that the first page of reviews never dominates a phone-length page; the rest
// load on demand (GET /salons/:id/reviews is paginated server-side, newest first).
const REVIEWS_PAGE_SIZE = 10

const route = useRoute()
const slug = route.params.slug as string
const { apiFetch } = useApi()
const session = useSessionStore()
// Stories/portfolio already come back empty from the API when their flag is off (see
// PublicSalonContentController), so their existing `v-if="...length"` guards handle that
// for free -- only reviews needs an explicit check here, since SalonReviews and the rating
// link both render unconditionally (an empty reviews array still shows a "no reviews yet"
// state, which would misrepresent the feature as off-by-content rather than off-by-flag).
const { flags: featureFlags } = useFeatureFlags()

// Resolved once, client-side (document.referrer is empty/unavailable during SSR anyway) --
// carried onto the "Book" link's own query string so the booking page can read it at
// submission time. See utils/attribution.ts's own doc comment for why this lives here
// rather than sessionStorage: the salon page is always the entry point a QR/shareable link
// lands on, never the booking page directly. Also handed down to StoryViewer/PortfolioGrid,
// whose own booking pills are entry points onto the same booking page.
const attributionSource = ref<AttributionSource | null>(null)
onMounted(() => {
  attributionSource.value = resolveAttributionSource(route.query.source, document.referrer)
})
function bookingLink(serviceId: string): string {
  return buildBookingLink(slug, serviceId, attributionSource.value)
}

// Two outcomes in one payload so the whole decision is made in a single SSR pass: either the
// page's data, or the current handle of a salon whose handle this used to be. The canonical
// lookup only runs on the path where the profile fetch ALREADY 404'd, so a live handle costs
// no extra request -- see the API's SalonsService.resolveCanonicalSlug for why the profile
// endpoint deliberately does not serve a renamed salon under its old handle itself.
const { data: resolved } = await useAsyncData(`salon-${slug}`, async () => {
  const salonRes = await apiFetch<Salon>(`/salons/${slug}`, { silent: true })
  if (!salonRes.data) {
    const canonicalRes = await apiFetch<{ slug: string; moved: boolean }>(`/salons/${slug}/canonical`, { silent: true })
    const movedTo = canonicalRes.data?.moved ? canonicalRes.data.slug : null
    return { movedTo, page: null }
  }

  const [servicesRes, packagesRes, hoursRes, exceptionsRes, photosRes, reviewsRes, portfolioRes, workersRes, termsRes] = await Promise.all([
    apiFetch<SalonServiceItem[]>(`/salons/${slug}/services`, { silent: true }),
    apiFetch<SalonPackage[]>(`/salons/${slug}/packages`, { silent: true }),
    apiFetch<WorkingHourItem[]>(`/salons/${slug}/hours`, { silent: true }),
    apiFetch<SalonExceptionItem[]>(`/salons/${slug}/exceptions`, { silent: true }),
    apiFetch<PhotoItem[]>(`/salons/${slug}/photos`, { silent: true }),
    // First page only during SSR; «نمایش نظرات بیشتر» pages the rest in on demand.
    apiFetch<ReviewsPage>(`/salons/${salonRes.data.id}/reviews`, { query: { page: 1, pageSize: REVIEWS_PAGE_SIZE }, silent: true }),
    apiFetch<SalonPortfolioItem[]>(`/salons/${slug}/portfolio`, { silent: true }),
    apiFetch<WorkerItem[]>(`/salons/${slug}/workers`, { silent: true }),
    apiFetch<BookingTerms>('/platform-config/booking-terms', { silent: true }),
  ])

  return {
    movedTo: null as string | null,
    page: {
      salon: salonRes.data,
      services: servicesRes.data ?? [],
      packages: packagesRes.data ?? [],
      hours: hoursRes.data ?? [],
      // Already future-dated (today included) by the API -- see public-salon-content.controller.ts.
      exceptions: exceptionsRes.data ?? [],
      photos: photosRes.data ?? [],
      reviews: reviewsRes.data?.items ?? [],
      reviewsTotal: reviewsRes.data?.total ?? 0,
      portfolio: portfolioRes.data ?? [],
      workers: workersRes.data ?? [],
      terms: termsRes.data,
    },
  }
})

// Everything below (and the whole template) still reads `page` exactly as before -- only the
// wrapper around it changed, so the redirect could ride along in the same payload.
const page = computed(() => resolved.value?.page ?? null)
const contact = computed(() => formatContactPhone(page.value?.salon.contactPhone))
const memberSince = computed(() => formatMemberSince(page.value?.salon.memberSince))

if (resolved.value?.movedTo) {
  // A PERMANENT redirect, not the default 302: this handle will never come back (it stays
  // reserved to this salon in salon_slug_history), so search engines should transfer the old
  // URL's ranking rather than keep re-checking it. The query string is carried over verbatim
  // because a printed QR code's `?source=qr` is the entire reason handle history exists --
  // losing it here would silently mis-attribute every scan of every already-printed code.
  //
  // `<script setup>` cannot early-return, so the SEO block below lives in the else branch:
  // navigateTo on the server only stages the response (it does not abort this setup), and
  // the template's own `v-if="page"` Suspense guard already renders nothing for a null page.
  await navigateTo({ path: `/salons/${resolved.value.movedTo}`, query: route.query }, { redirectCode: 301, replace: true })
} else if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Salon not found' })
} else {
  // about-excerpt ?? tagline ?? description ?? name—address (empty strings fall through).
  const seoDescription = resolveSalonDescription(page.value.salon)
  // Falls back to the first portfolio image when the salon has no gallery photos.
  const seoImage = page.value.photos[0]?.url ?? page.value.portfolio[0]?.url
  // Built from the ROUTE's slug, which is always the salon's current handle by this point (a
  // former handle 301s above and never renders) -- so a salon page has exactly one canonical
  // URL no matter how many handles it has worn. Same absolute-URL-from-request pattern as
  // blog/[slug].vue.
  const canonicalUrl = `${useRequestURL().origin}/salons/${slug}`

  useSeoMeta({
    title: page.value.salon.name,
    description: seoDescription,
    ogTitle: page.value.salon.name,
    ogDescription: seoDescription,
    ogUrl: canonicalUrl,
    ogImage: seoImage,
    // 'summary_large_image' only makes sense once there's actually an image to show large;
    // with none, 'summary' is the correct (and still valid) fallback card type.
    twitterCard: seoImage ? 'summary_large_image' : 'summary',
  })

  useHead({
    link: [{ rel: 'canonical', href: canonicalUrl }],
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
          telephone: page.value.salon.contactPhone || undefined,
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
}

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
  // Same reason the template carries `v-if="page"`: on the handle-redirect path there is no
  // salon here at all (the 301 above is what this render is for), and on the client the
  // outgoing navigation can still let this hook fire once before the component is discarded.
  if (!page.value) return
  storySeen.value = readStorySeen(page.value.salon.id)
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

// Reviews beyond the SSR'd first page, appended client-side. Seeded from the payload so the
// list hydrates identically; a failed page leaves what is already shown in place and the
// button stays for another try.
const extraReviews = ref<ReviewItem[]>([])
const reviewsPage = ref(1)
const loadingMoreReviews = ref(false)
const allReviews = computed(() => [...(page.value?.reviews ?? []), ...extraReviews.value])

async function loadMoreReviews() {
  if (!page.value || loadingMoreReviews.value) return
  loadingMoreReviews.value = true
  const next = reviewsPage.value + 1
  const { data } = await apiFetch<ReviewsPage>(`/salons/${page.value.salon.id}/reviews`, {
    query: { page: next, pageSize: REVIEWS_PAGE_SIZE },
    silent: true,
  })
  loadingMoreReviews.value = false
  if (!data) {
    useToast().push('بارگذاری نظرات بیشتر ممکن نشد؛ دوباره تلاش کنید.', 'error')
    return
  }
  // A review can arrive twice if new ones were published between pages (offset paging).
  const seen = new Set(allReviews.value.map((r) => r.id))
  extraReviews.value.push(...data.items.filter((r) => !seen.has(r.id)))
  reviewsPage.value = next
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

// A weekday can carry more than one working_hours row (a lunch-break split shift) -- grouped
// by weekday BEFORE rendering, or two rows for the same day would render as two separate <li>s
// both keyed on the same weekday.weekday (a duplicate Vue key), reading as two unrelated lines
// ("شنبه: ۰۹:۰۰ - ۱۳:۰۰" immediately followed by another "شنبه: ۱۴:۰۰ - ۲۰:۰۰") instead of one
// merged row.
interface GroupedHours { weekday: number; ranges: WorkingHourItem[] }
const orderedHours = computed<GroupedHours[]>(() => {
  const byWeekday = new Map<number, GroupedHours>()
  for (const h of page.value?.hours ?? []) {
    const existing = byWeekday.get(h.weekday)
    if (existing) existing.ranges.push(h)
    else byWeekday.set(h.weekday, { weekday: h.weekday, ranges: [h] })
  }
  return WEEKDAY_DISPLAY_ORDER.map((w) => byWeekday.get(w)).filter((g): g is GroupedHours => g !== undefined)
})

// Same noon-UTC anchor as booking/SlotPicker's own formatDateLabel (slot-format.ts) -- keeps
// a bare 'YYYY-MM-DD' on its intended Iran calendar day regardless of the viewer's own system
// timezone or DST edge cases, rather than a UTC-midnight parse silently shifting it a day.
function formatClosureDate(dateStr: string): string {
  return new Intl.DateTimeFormat('fa-IR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Tehran' }).format(
    new Date(`${dateStr}T12:00:00Z`),
  )
}

function formatClosureTimeRange(e: SalonExceptionItem): string | null {
  if (!e.startTime || !e.endTime) return null
  return `${toPersianDigits(e.startTime.slice(0, 5))} تا ${toPersianDigits(e.endTime.slice(0, 5))}`
}

// "باز / بسته" status, deliberately left null until onMounted rather than computed eagerly:
// SSR renders and the client hydrate at genuinely different wall-clock instants, so a plain
// `computed` risks a hydration mismatch the moment those two reads straddle a boundary (an
// open/closed flip, or simply two Date.now() calls a moment apart). The badge is just absent
// for one tick instead of briefly showing the wrong state.
const isOpenNow = ref<boolean | null>(null)
const todayWeekday = ref<number | null>(null)

onMounted(() => {
  if (!page.value?.hours.length) return
  // JS has no direct "get the weekday/time as seen in another timezone" API short of Intl --
  // this is the standard round-trip trick: format "now" as a Tehran-local wall-clock string,
  // then re-parse it, so the resulting Date's own getDay()/getHours()/getMinutes() (which
  // always read in the SYSTEM's local time) end up reporting Tehran's values instead.
  const tehranNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tehran' }))
  todayWeekday.value = tehranNow.getDay()
  const hhmm = `${String(tehranNow.getHours()).padStart(2, '0')}:${String(tehranNow.getMinutes()).padStart(2, '0')}`

  // A schedule_exceptions row for today overrides the normal weekly hours entirely -- a
  // whole-day closure (both times null) always means closed; a partial one only means closed
  // while `hhmm` actually falls inside it (the salon's normal hours still apply outside it).
  const todayDateStr = `${tehranNow.getFullYear()}-${String(tehranNow.getMonth() + 1).padStart(2, '0')}-${String(tehranNow.getDate()).padStart(2, '0')}`
  const todayException = page.value.exceptions.find((e) => e.date === todayDateStr)
  if (todayException && (!todayException.startTime || !todayException.endTime)) {
    isOpenNow.value = false
    return
  }
  if (todayException?.startTime && todayException?.endTime && hhmm >= todayException.startTime.slice(0, 5) && hhmm < todayException.endTime.slice(0, 5)) {
    isOpenNow.value = false
    return
  }

  // .some(), not .find()'s old first-match-only check: a lunch-break split shift means today
  // can have more than one range, and the afternoon one must count too.
  const todayRanges = page.value.hours.filter((h) => h.weekday === todayWeekday.value)
  if (todayRanges.length === 0) {
    isOpenNow.value = false
    return
  }
  // Every existing schedule is same-day (open < close, no midnight-crossing support
  // anywhere in this system -- confirmed against ScheduleStep.vue's own openTime<closeTime
  // validation), so a plain string comparison is safe and never needs a wraparound case.
  isOpenNow.value = todayRanges.some((r) => hhmm >= r.openTime.slice(0, 5) && hhmm < r.closeTime.slice(0, 5))
})

// The desktop booking card's one-line "today" summary, from the same client-only weekday
// as the open/closed badge (null until mounted, so SSR and hydration agree).
const todayHoursLabel = computed(() => {
  if (todayWeekday.value === null) return null
  const ranges = (page.value?.hours ?? []).filter((h) => h.weekday === todayWeekday.value)
  if (!ranges.length) return null
  return ranges.map((r) => `${toPersianDigits(r.openTime.slice(0, 5))} - ${toPersianDigits(r.closeTime.slice(0, 5))}`).join('، ')
})

// Anchors the sticky footer's "شروع از X تومان" -- the cheapest HONEST floor across every
// service: FIXED's own discounted price (never the pre-discount price, which no customer
// would actually pay -- discounting never applies to FROM/RANGE, see
// service-pricing.util.ts's validateDiscountForPricingType), or FROM/RANGE's own floor
// price (a real lower bound the actual price can never fall below). QUOTE has no number at
// all and is excluded, mirroring search.service.ts's own min_price computation exactly.
const minServicePrice = computed(() => {
  const prices = (page.value?.services ?? [])
    .map((s) => (s.pricingType === 'fixed' ? applyDiscount(s.price!, s.discountPercent) : s.price))
    .filter((p): p is number => p !== null)
  return prices.length ? Math.min(...prices) : null
})

// The #services/#reviews links below used to be plain `<a href="#...">` anchors, relying on
// the browser's native fragment-navigation -- reported as doing nothing when clicked from the
// sticky footer. `scrollIntoView` is explicit and doesn't depend on how the browser/Nuxt's
// router happens to treat a same-page hash change; `href` stays on the tags for keyboard/
// middle-click/no-JS, this just takes over the primary click path.
// The thumbnail column appears only when at least one service has a photo: a salon that never
// uploaded any keeps the plain text menu instead of a column of identical placeholders, while a
// salon with a few photos gets one aligned column (placeholders fill the gaps so names line up).
const servicesHaveImages = computed(() => (page.value?.services ?? []).some((s) => !!s.imageUrl))

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <!-- Top-level guard, not just the `page!` assertions below: when the createError(404) throw
       above rejects this component's async setup, Vue's Suspense still runs one render pass of
       this template with `page` at its pre-fetch value (undefined) before the rejection is
       handled. Without this v-if, that pass throws inside the render function itself (an
       unhandled rejection, not the createError) -- see blog/[slug].vue, which this mirrors. -->
  <div v-if="page" class="mx-auto max-w-2xl space-y-6 p-4 lg:max-w-6xl lg:p-6">
    <SalonHero
      :photos="page.photos"
      :fallback-photo="page.portfolio[0]?.url ?? null"
      :salon-name="page.salon.name"
      :is-favorited="isFavorited"
      :favorite-busy="favoriteBusy"
      @toggle-favorite="toggleFavorite"
    >
      <template #corner>
        <StoriesRing
          v-if="stories.length"
          :stories="stories"
          :cover-photo="page.photos[0]?.url ?? null"
          :last-seen="storySeen"
          @open="viewerOpen = true"
        />
      </template>
    </SalonHero>

    <!-- Desktop: content column + a sticky booking card on the end (left, in RTL) side. The card
         is the only sticky thing, and it is short, so it can never outgrow the viewport and trap
         content below its fold (the old aside stuck the map and the whole hours list too).
         Phones: one column in the same reading order as before; the card is replaced by the
         fixed bottom bar. -->
    <div class="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
      <div class="min-w-0 space-y-6">
        <div>
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <!-- break-words, not just the wrapper's min-w-0: a provider-authored salon name
                   can be one long unbreakable token, and min-w-0 only lets the BOX shrink --
                   the text inside it still overflows unless it is allowed to break. -->
              <h1 class="text-xl font-bold break-words text-(--color-text) lg:text-2xl">{{ page.salon.name }}</h1>
              <!-- A plain statement of fact we actually hold (the join date) -- approval only means an
                   admin reviewed self-declared data, so nothing here claims the salon is "verified". -->
              <p v-if="memberSince" data-testid="salon-member-since" class="mt-1 text-xs text-(--color-text-muted)">{{ memberSince }}</p>
            </div>
            <SalonShareButton :slug="slug" :salon-name="page.salon.name" class="shrink-0" />
          </div>
          <p v-if="page.salon.tagline" data-testid="salon-tagline" class="mt-1 text-sm text-(--color-text-muted)">{{ page.salon.tagline }}</p>
          <a
            v-if="featureFlags.reviewsEnabled"
            href="#reviews"
            class="mt-1 flex min-h-11 w-fit items-center text-sm underline-offset-2 hover:underline"
            @click.prevent="scrollToSection('reviews')"
          >
            <RatingLabel :average="page.salon.ratingAvg" :count="page.salon.ratingCount" />
          </a>
          <!-- items-start: at 320px a Persian street address wraps to three lines, which
               `items-center` would leave the pin floating against the middle of. -->
          <p class="mt-1 flex items-start gap-1 text-sm text-(--color-text-muted)">
            <BaseIcon name="map-pin" :size="14" class="mt-0.5 shrink-0" />
            <span class="min-w-0">{{ page.salon.address }}</span>
          </p>
          <!-- Phones: the call link sits by the address (desktop has its own copy in the booking
               card). Hidden entirely when the salon gave no contact number. -->
          <a
            v-if="contact"
            :href="contact.href"
            data-testid="salon-contact-mobile"
            class="mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-(--color-accent-text) hover:underline lg:hidden"
          >
            <BaseIcon name="phone" :size="14" />
            تماس با سالن
            <span dir="ltr" class="tnum text-(--color-text-muted)">{{ contact.display }}</span>
          </a>
          <!-- Phones: the map and directions live further down the page, so offer a jump
               straight to them from the address instead of making the customer scroll. -->
          <a
            href="#location"
            class="mt-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-(--color-accent-text) hover:underline lg:hidden"
            @click.prevent="scrollToSection('location')"
          >
            نقشه و مسیریابی
            <BaseIcon name="chevron-back" :size="14" />
          </a>
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

        <section v-if="page.salon.about" data-testid="salon-about">
          <h2 class="mb-2 text-xl font-bold text-(--color-text)">درباره سالن</h2>
          <!-- Plain text by design: interpolation only (never v-html), line breaks preserved. -->
          <p class="text-sm whitespace-pre-line">{{ page.salon.about }}</p>
        </section>

        <section id="services" class="scroll-mt-20">
          <h2 class="mb-2 text-xl font-bold text-(--color-text)">خدمات</h2>
          <!-- Neutral (surface-subtle), not accent-soft -- keeps the surface calm. A booking's
               financial commitment must never feel hidden or ambiguous; equally, with the
               platform's online-payment flag off the API confirms every booking with nothing
               collected, so stating a deposit "is taken" would be a straight lie -- say what
               actually happens instead, matching the booking page's own flag-off copy. -->
          <div data-testid="booking-policy-callout" class="mb-3 space-y-1.5 rounded-xl bg-(--color-surface-subtle) p-3 text-xs text-(--color-text-muted)">
            <template v-if="featureFlags.onlinePaymentEnabled">
              <p class="flex items-start gap-1.5">
                <BaseIcon name="shield" :size="14" class="mt-0.5 shrink-0" />
                <span v-if="page.terms">
                  برای تضمین نوبت، بیعانه آنلاین معادل ٪{{ page.terms.depositPercent.toLocaleString('fa-IR') }} مبلغ خدمت
                  (حداقل <span dir="ltr" class="tnum">{{ formatToman(page.terms.depositMinToman) }}</span> تومان) دریافت می‌شود.
                </span>
                <span v-else>برای تضمین نوبت، بیعانه آنلاین دریافت می‌شود.</span>
              </p>
              <p v-if="page.terms" class="flex items-start gap-1.5">
                <BaseIcon name="clock" :size="14" class="mt-0.5 shrink-0" />
                <span>لغو رایگان تا {{ page.terms.cancellationWindowHours.toLocaleString('fa-IR') }} ساعت پیش از نوبت امکان‌پذیر است.</span>
              </p>
            </template>
            <p v-else class="flex items-start gap-1.5">
              <BaseIcon name="shield" :size="14" class="mt-0.5 shrink-0" />
              <span>بیعانه‌ای دریافت نمی‌شود؛ هزینه خدمت در سالن پرداخت می‌شود.</span>
            </p>
          </div>
          <!-- ONE grouped surface with dividers, not a bordered card per service: a long menu of
               separate boxes is slower to scan than a single list. Service photos live here, on
               their own rows -- the portfolio further down is the salon's past work, a different
               thing, and the two are never mixed. -->
          <ul v-if="page.services.length" class="divide-y divide-(--color-border) overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-sm)">
            <li v-for="service in page.services" :key="service.id">
              <!-- Only a FIXED-price service can go through the automatic online booking flow
                   (the API rejects a hold attempt against any other pricing type -- see
                   BookingsService.createHoldImpl's pricingType guard), so FROM/RANGE/QUOTE
                   block the click into a flow that would 400 at submission and drop the hover
                   affordance. -->
              <NuxtLink
                :to="bookingLink(service.id)"
                class="block px-4 py-3.5 text-sm transition-colors"
                :class="service.pricingType === 'fixed' ? 'hover:bg-(--color-surface-subtle) active:bg-(--color-surface-subtle)' : 'cursor-default'"
                @click="(e: MouseEvent) => { if (service.pricingType !== 'fixed') e.preventDefault() }"
              >
                <!-- Fixed square thumbnail at the row's start, with explicit width/height so a
                     lazy photo never shifts the text beside it. -->
                <div :class="servicesHaveImages ? 'flex items-start gap-3' : undefined">
                  <div
                    v-if="servicesHaveImages"
                    data-testid="service-thumb"
                    class="size-14 shrink-0 overflow-hidden rounded-xl bg-(--color-surface-subtle) min-[360px]:size-16 sm:size-[72px]"
                  >
                    <SafeImage
                      v-if="service.imageUrl"
                      :src="service.imageUrl"
                      :alt="service.name"
                      :width="144"
                      :height="144"
                      loading="lazy"
                      :placeholder-icon-size="20"
                      class="h-full w-full object-cover"
                    />
                    <SalonImagePlaceholder v-else :icon-size="20" />
                  </div>
                  <div :class="servicesHaveImages ? 'min-w-0 flex-1' : undefined">
                    <!-- At 320px a provider-authored name, a discount badge and a seven-figure
                         price do not fit one line: the name breaks, the badge and each price
                         stay whole and wrap as units. -->
                    <div class="flex items-center justify-between gap-3" :class="servicesHaveImages ? 'flex-wrap gap-y-1' : undefined">
                      <span class="min-w-0 break-words font-medium text-(--color-text)">
                        {{ service.name }}
                        <span class="font-normal text-(--color-text-muted)">· {{ service.durationMin.toLocaleString('fa-IR') }} دقیقه</span>
                      </span>
                      <ServicePriceTag :service="service" />
                    </div>
                    <p v-if="service.pricingType !== 'fixed'" class="mt-1 text-xs text-(--color-text-muted)">
                      برای رزرو این خدمت باید ابتدا با سالن هماهنگ کنید.
                    </p>
                    <!-- Provider-authored note on the listed duration (e.g. "may take longer"). -->
                    <p v-if="service.description" class="mt-1.5 text-xs text-(--color-text-muted)">{{ service.description }}</p>
                    <p v-if="service.pricingType === 'fixed'" class="mt-1.5 flex items-center gap-0.5 text-xs font-semibold text-(--color-accent-text)">
                      انتخاب و رزرو
                      <BaseIcon name="chevron-back" :size="12" />
                    </p>
                  </div>
                </div>
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

        <!-- Packages are catalog/display only -- never bookable as one unit (see
             SalonPackage's own doc comment on the backend). -->
        <section v-if="page.packages.length" id="packages">
          <h2 class="mb-2 text-xl font-bold text-(--color-text)">پکیج‌ها</h2>
          <ul class="space-y-2">
            <li
              v-for="pkg in page.packages"
              :key="pkg.id"
              class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-4 text-sm shadow-(--shadow-sm)"
            >
              <div class="flex items-center justify-between gap-3">
                <span class="min-w-0 break-words font-bold text-(--color-text)">{{ pkg.name }}</span>
                <span class="font-bold whitespace-nowrap text-(--color-text)">
                  <template v-if="pkg.pricingType === 'quote'">قیمت توافقی</template>
                  <template v-else-if="pkg.pricingType === 'range'">
                    <span dir="ltr" class="tnum">{{ formatToman(pkg.price!) }}</span> تا
                    <span dir="ltr" class="tnum">{{ formatToman(pkg.priceMax!) }}</span> تومان
                  </template>
                  <template v-else-if="pkg.pricingType === 'from'">
                    از <span dir="ltr" class="tnum">{{ formatToman(pkg.price!) }}</span> تومان
                  </template>
                  <template v-else>
                    <span dir="ltr" class="tnum">{{ formatToman(pkg.price!) }}</span> تومان
                  </template>
                </span>
              </div>
              <p v-if="pkg.description" class="mt-1 text-xs text-(--color-text-muted)">{{ pkg.description }}</p>
              <ul class="mt-2 flex flex-wrap gap-1.5">
                <li
                  v-for="item in pkg.items"
                  :key="item.serviceId"
                  class="rounded-full bg-(--color-surface-subtle) px-2.5 py-1 text-xs text-(--color-text-muted)"
                >
                  {{ item.name }}
                </li>
              </ul>
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
          :attribution-source="attributionSource"
        />

        <SalonTeam :workers="page.workers" />

        <SalonReviews
          v-if="featureFlags.reviewsEnabled"
          :reviews="allReviews"
          :total="page.reviewsTotal"
          :loading-more="loadingMoreReviews"
          :can-report="canReport"
          @report="openReviewReport"
          @load-more="loadMoreReviews"
        />

        <!-- Location and hours: one section, side by side on desktop (map | hours) where the
             column is wide enough, stacked on phones in the same order as before. -->
        <div class="space-y-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
          <section id="location" class="scroll-mt-20">
            <h2 class="mb-2 flex items-center gap-1.5 text-xl font-bold text-(--color-text)">
              <BaseIcon name="map-pin" :size="17" class="text-(--color-text-muted)" />
              موقعیت مکانی
            </h2>
            <div class="space-y-2">
              <LazySalonMap
                compact
                data-testid="salon-map"
                :salons="salonMapData.salons"
                :center="salonMapData.center"
                :salon-coords="salonMapData.salonCoords"
              />
              <!-- Exposed directly here, not just inside the map's own marker popup two taps deep. -->
              <div class="grid grid-cols-2 gap-2 text-xs font-semibold">
                <a
                  :href="neshanUrl(salonMapData.center.lat, salonMapData.center.lng)"
                  target="_blank"
                  rel="noopener"
                  class="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-(--color-border) bg-(--color-surface-card) text-(--color-text) transition-colors hover:bg-(--color-surface-subtle)"
                >
                  مسیریابی با نشان
                </a>
                <a
                  :href="googleMapsUrl(salonMapData.center.lat, salonMapData.center.lng)"
                  target="_blank"
                  rel="noopener"
                  class="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-(--color-border) bg-(--color-surface-card) text-(--color-text) transition-colors hover:bg-(--color-surface-subtle)"
                >
                  مسیریابی با گوگل‌مپ
                </a>
              </div>
            </div>
          </section>

          <section>
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <h2 class="flex items-center gap-1.5 text-xl font-bold text-(--color-text)">
                <BaseIcon name="clock" :size="17" class="text-(--color-text-muted)" />
                ساعات کاری
              </h2>
              <!-- Computed client-side only (see isOpenNow's own comment). Neutral colors
                   throughout -- being closed right now is normal information, not an error. -->
              <span
                v-if="isOpenNow !== null"
                data-testid="hours-open-status"
                class="rounded-full px-2 py-0.5 text-xs font-bold"
                :class="isOpenNow ? 'bg-(--color-surface-subtle) text-(--color-success)' : 'bg-(--color-surface-subtle) text-(--color-text-muted)'"
              >
                {{ isOpenNow ? 'باز است' : 'بسته است' }}
              </span>
            </div>
            <ul v-if="page.hours.length" data-testid="hours-list" class="space-y-1 text-sm text-(--color-text)">
              <li
                v-for="day in orderedHours"
                :key="day.weekday"
                class="flex items-center justify-between gap-2 rounded-lg px-2 py-1"
                :class="day.weekday === todayWeekday ? 'bg-(--color-surface-subtle) font-bold' : ''"
              >
                <span class="shrink-0">{{ WEEKDAY_NAMES[day.weekday] }}</span>
                <span class="mx-1 min-w-4 flex-1 self-center border-b border-dotted border-(--color-border)" aria-hidden="true" />
                <!-- dir="ltr" isn't decorative: without it the bidi algorithm reorders this
                     RTL-embedded "09:00 - 20:00" run so open/close visually swap. Applied to the
                     WHOLE joined string so a split shift's two ranges keep their real order. -->
                <span dir="ltr" class="tnum text-end">
                  <template v-for="(dayRange, i) in day.ranges" :key="i">
                    <span v-if="i > 0">، </span>{{ toPersianDigits(dayRange.openTime.slice(0, 5)) }} - {{ toPersianDigits(dayRange.closeTime.slice(0, 5)) }}
                  </template>
                </span>
              </li>
            </ul>
            <p v-else data-testid="hours-empty" class="text-sm text-(--color-text-muted)">ساعات کاری ثبت نشده است</p>

            <!-- Purely explanatory -- the booking flow itself already can't offer a slot on a
                 closed day/interval (server-enforced, availability.util.ts). -->
            <div v-if="page.exceptions.length" data-testid="upcoming-closures" class="mt-3 space-y-1 border-t border-(--color-border) pt-3">
              <p class="text-xs font-semibold text-(--color-text-muted)">تعطیلی‌های پیش رو</p>
              <p v-for="e in page.exceptions" :key="e.date" class="text-xs text-(--color-text-muted)">
                {{ formatClosureDate(e.date) }}
                <span v-if="formatClosureTimeRange(e)">(<span dir="ltr" class="tnum">{{ formatClosureTimeRange(e) }}</span>)</span>
                <span v-if="e.reason"> — {{ e.reason }}</span>
              </p>
            </div>
          </section>
        </div>

        <button
          v-if="canReport"
          type="button"
          data-testid="report-salon-button"
          class="inline-flex min-h-11 items-center text-xs opacity-70 underline"
          @click="openSalonReport"
        >
          گزارش این سالن
        </button>
      </div>

      <!-- Desktop only. Short by design so `sticky` is safe: price floor, the one action the page
           exists for, today's status and the phone number -- all real data already on the page. -->
      <aside class="hidden lg:block">
        <div class="sticky top-20 space-y-3">
          <div data-testid="booking-summary" class="space-y-4 rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-5 shadow-(--shadow-md)">
            <div v-if="minServicePrice !== null">
              <!-- «شروع از»: the cheapest honest floor (see minServicePrice) -- never an exact
                   price, and never a quote-only service. -->
              <p class="text-sm text-(--color-text-muted)">شروع از</p>
              <p class="text-2xl font-bold text-(--color-text)"><span dir="ltr" class="tnum">{{ formatToman(minServicePrice) }}</span> <span class="text-base">تومان</span></p>
            </div>
            <p v-else class="text-sm text-(--color-text-muted)">قیمت خدمات این سالن پس از هماهنگی مشخص می‌شود.</p>
            <a
              href="#services"
              class="flex min-h-12 items-center justify-center rounded-xl bg-(--color-accent) px-5 text-sm font-semibold text-(--color-fill-text) shadow-(--shadow-sm) transition-colors duration-150 hover:bg-(--color-accent-deep) active:bg-(--color-accent-pressed)"
              @click.prevent="scrollToSection('services')"
            >
              مشاهده خدمات و رزرو
            </a>
            <ul class="space-y-2 border-t border-(--color-border) pt-4 text-sm">
              <li v-if="featureFlags.reviewsEnabled" class="flex items-center justify-between gap-2">
                <span class="text-(--color-text-muted)">امتیاز</span>
                <RatingLabel :average="page.salon.ratingAvg" :count="page.salon.ratingCount" />
              </li>
              <li v-if="isOpenNow !== null" class="flex items-center justify-between gap-2" data-testid="summary-today">
                <span class="text-(--color-text-muted)">امروز</span>
                <span class="flex items-center gap-2">
                  <span v-if="todayHoursLabel" dir="ltr" class="tnum text-(--color-text)">{{ todayHoursLabel }}</span>
                  <span class="font-semibold" :class="isOpenNow ? 'text-(--color-success)' : 'text-(--color-text-muted)'">{{ isOpenNow ? 'باز است' : 'بسته است' }}</span>
                </span>
              </li>
              <li class="flex items-start gap-1.5 text-(--color-text-muted)">
                <BaseIcon name="shield" :size="14" class="mt-0.5 shrink-0" />
                <span v-if="featureFlags.onlinePaymentEnabled">برای تضمین نوبت، بیعانه آنلاین دریافت می‌شود.</span>
                <span v-else>بیعانه‌ای دریافت نمی‌شود؛ هزینه در سالن پرداخت می‌شود.</span>
              </li>
            </ul>
          </div>

          <a
            v-if="contact"
            :href="contact.href"
            data-testid="salon-contact-desktop"
            class="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-(--color-border) bg-(--color-surface-card) px-4 text-sm font-semibold text-(--color-text) transition-colors hover:bg-(--color-surface-subtle)"
          >
            <BaseIcon name="phone" :size="16" />
            تماس با سالن
            <span dir="ltr" class="tnum text-(--color-text-muted)">{{ contact.display }}</span>
          </a>
          <a
            href="#location"
            class="flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium text-(--color-accent-text) transition-colors hover:bg-(--color-surface-subtle)"
            @click.prevent="scrollToSection('location')"
          >
            <BaseIcon name="navigation" :size="15" />
            نقشه و مسیریابی
          </a>
        </div>
      </aside>
    </div>

    <ReportForm v-if="reportOpen" :salon-id="page.salon.id" :review-id="reportReviewId" @close="closeReport" />

    <LazyStoryViewer
      v-if="viewerOpen && stories.length"
      :stories="stories"
      :services="page.services"
      :slug="slug"
      :salon-id="page.salon.id"
      :can-report="canReport"
      :attribution-source="attributionSource"
      @close="closeStoryViewer"
    />

    <!-- Phones: sticky footer CTA, the only persistent way back to "book" on a page long enough
         to scroll through photos/map/about/portfolio/hours/team/reviews. -->
    <div
      v-if="minServicePrice !== null"
      class="fixed inset-x-0 bottom-0 z-40 border-t border-(--color-border) bg-(--color-surface-card) lg:hidden"
      style="padding-bottom: env(safe-area-inset-bottom)"
    >
      <div class="mx-auto flex max-w-2xl items-center justify-between gap-3 p-4">
        <p class="min-w-0 text-sm">
          <span class="text-(--color-text-muted)">شروع از</span>
          <span class="font-bold text-(--color-text)"> <span dir="ltr" class="tnum">{{ formatToman(minServicePrice) }}</span> تومان</span>
        </p>
        <a
          href="#services"
          class="flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-(--color-accent) px-5 text-sm font-semibold text-(--color-fill-text) shadow-(--shadow-sm) transition-colors duration-150 hover:bg-(--color-accent-deep) active:bg-(--color-accent-pressed)"
          @click.prevent="scrollToSection('services')"
        >
          مشاهده خدمات
        </a>
      </div>
    </div>
  </div>
</template>
