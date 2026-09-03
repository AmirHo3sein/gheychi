<script setup lang="ts">
import type { SearchPage } from '../../utils/types'
import { buildCanonicalUrl } from '../../utils/canonical-url'

interface PublicCity { id: number; name: string; slug: string; province: string; lat: number; lng: number }

/**
 * Public, SSR-rendered salon browse page -- the crawlable discovery path this site did not
 * have.
 *
 * The home page can't be that path and isn't meant to become one: it loads results in
 * onMounted (nothing in the server-rendered html) and hard-gates on a session, because
 * GET /search's `gender` param is REQUIRED and the only place a gender comes from there is
 * the signed-in user's own profile. An anonymous crawler therefore sees a home page with
 * zero salon links, leaving the sitemap as the sole entry channel into /salons/:slug -- and
 * a url reachable only from a sitemap gets crawled without any of the internal-link context
 * that tells a search engine it matters.
 *
 * This page solves that WITHOUT any API change: GET /search is already `@Public()` (see
 * apps/api/src/search/search.controller.ts) -- the session was never the blocker, the
 * required `gender`/`lat`/`lng` params were. So gender becomes an explicit, visible facet in
 * the url and the coordinates come from the public GET /cities table. Both facet values are
 * rendered as real <a> links, so following them is how a crawler reaches every approved
 * salon of either gender target, in every city.
 *
 * Why not build the listing from the sitemap source (GET /sitemap/salon-slugs) instead: it
 * returns bare slug strings and nothing else, so a page built on it could only ever be a wall
 * of unlabelled links -- useless to a human, and thin-content to a crawler.
 */

const route = useRoute()
const config = useRuntimeConfig()
const { apiFetch } = useApi()

// Deliberately smaller than /search's own 50 default: a browse page wants a next-page link a
// crawler can follow (see the cursor note below) more than it wants one very long page.
const PAGE_SIZE = 24

// Anything that isn't the literal 'men' browses women's salons. Normalising rather than
// 404ing on a junk value is safe here precisely BECAUSE the canonical below only ever emits
// `gender=men` explicitly: `?gender=nonsense` renders the women's listing and canonicalises
// away to the bare /salons, so no amount of junk in this param mints an indexable duplicate.
const gender = computed<'women' | 'men'>(() => (route.query.gender === 'men' ? 'men' : 'women'))
// Distinct from `activeCity` below: this is what the URL literally asked for ('' = nothing
// asked), which is what the canonical has to mirror -- not what it resolved to.
const requestedCitySlug = computed(() => (typeof route.query.city === 'string' ? route.query.city : ''))
// Opaque, server-issued continuation token, round-tripped verbatim from a previous response's
// `nextCursor` -- never constructed here. SearchQueryDto documents that contract, and honouring
// it is why pagination is a cursor in the url rather than a friendlier `?page=2`: the encoding
// is the API's private business. A crawler discovers page N+1 the same way it discovers
// anything else, by following the rendered "next" <a>, so an opaque token costs nothing for
// crawl coverage -- only a little url readability.
const cursor = computed(() => (typeof route.query.cursor === 'string' ? route.query.cursor : ''))

// Unwatched and separately keyed so it is fetched once and then reused from the payload
// across every facet change -- the city table is seeded by migration and has no write path
// at all (see the API's CitiesService cache note), so re-fetching it per page turn would be
// pure waste.
const { data: cities } = await useAsyncData('public-cities', async () => {
  const { data } = await apiFetch<PublicCity[]>('/cities', { silent: true })
  return data ?? []
})

// GET /cities comes back ordered by sort_order, whose first row is Tehran -- so [0] is the
// default without this page having to hardcode a slug that a future re-seed could move.
const defaultCity = computed<PublicCity | null>(() => cities.value?.[0] ?? null)
const activeCity = computed<PublicCity | null>(() => {
  if (!requestedCitySlug.value) return defaultCity.value
  return cities.value?.find((c) => c.slug === requestedCitySlug.value) ?? null
})

// A city slug that resolves to nothing is a 404, not a silent fallback to Tehran. Falling
// back would serve identical content under unlimited invented urls (?city=anything), which
// is the exact duplicate-content shape a listing page must not have -- and it would lie to
// the visitor about which city they are looking at.
if (requestedCitySlug.value && cities.value?.length && !activeCity.value) {
  throw createError({ statusCode: 404, statusMessage: 'City not found' })
}

const { data: result, pending } = await useAsyncData(
  'salons-browse',
  async () => {
    const city = activeCity.value
    // Only reachable when GET /cities itself failed (the unknown-slug case already threw
    // above); reported through the same error card as a failed search.
    if (!city) return { failed: true, page: null as SearchPage | null }
    const { data } = await apiFetch<SearchPage>('/search', {
      query: {
        lat: city.lat,
        lng: city.lng,
        gender: gender.value,
        // Sorted by rating, not distance: distance from a city's *centroid* is a meaningless
        // ranking for someone browsing a whole city (unlike the home page, where it is the
        // searcher's own position), and rating puts the salons worth clicking on page one.
        sort: 'rating',
        pageSize: PAGE_SIZE,
        cursor: cursor.value || undefined,
      },
      silent: true,
    })
    // `failed` rather than inferring it from a null page: an empty result set and a broken
    // request are different states with different copy, and `data === null` alone can't tell
    // them apart once it has been unwrapped.
    return { failed: !data, page: data }
  },
  // activeCity is watched alongside the url facets, and it is not redundant with
  // requestedCitySlug: the city table is awaited above, so on first paint activeCity is
  // already settled and this costs nothing -- but it is what makes the cities-error retry
  // below actually work. Refreshing 'public-cities' alone would repopulate the table while
  // this entry, keyed on unchanged url facets, kept its failed result forever. Switching city
  // changes both watched sources in one tick, which Vue batches into a single refetch.
  { watch: [gender, requestedCitySlug, cursor, activeCity] },
)

const salons = computed(() => result.value?.page?.items ?? [])
const failed = computed(() => result.value?.failed === true)
const nextCursor = computed(() => result.value?.page?.nextCursor ?? null)

// Every facet link carries the facets it isn't changing, so switching gender keeps the city
// and turning a page keeps both -- these are navigable links, not reset buttons. Params are
// omitted at their default value for exactly the reason the canonical omits them: an extra
// `?gender=women` would be a second url for a page that already has one.
//
// Returns a plain string rather than a { path, query } route object so the rendered href is
// literal and self-evident in the SSR html (and in a test's DOM assertion) instead of
// depending on the router's own serialisation of a query object.
function browseLink(params: { gender?: 'women' | 'men'; city?: string; cursor?: string | null }): string {
  const query = new URLSearchParams()
  const nextGender = params.gender ?? gender.value
  const nextCity = params.city ?? requestedCitySlug.value
  if (nextGender === 'men') query.set('gender', 'men')
  if (nextCity) query.set('city', nextCity)
  if (params.cursor) query.set('cursor', params.cursor)
  const search = query.toString()
  return search ? `/salons?${search}` : '/salons'
}

const genderLabel = computed(() => (gender.value === 'men' ? 'مردانه' : 'زنانه'))
const cityName = computed(() => activeCity.value?.name ?? '')
const heading = computed(() => `سالن‌های زیبایی ${genderLabel.value} در ${cityName.value}`)
const description = computed(
  () => `فهرست سالن‌های زیبایی ${genderLabel.value} تایید‌شده در ${cityName.value} — امتیاز، خدمات و قیمت هر سالن را ببینید و نوبتتان را آنلاین رزرو کنید.`,
)

/**
 * Canonical strategy for this page's facet set.
 *
 * It mirrors the *requested* params after normalisation, never the resolved ones:
 *   - gender  emitted only for the explicit 'men' variant. Women's and men's listings are
 *             genuinely different salon sets (Salon.genderTarget is filtered with no bypass),
 *             so both deserve to be indexed -- but they need exactly one url each, and
 *             `/salons` already IS the women's url.
 *   - city    emitted only when the url asked for one, so `/salons` stays the canonical
 *             default-city page and `?city=tehran` folds into it rather than competing.
 *   - cursor  emitted as-is: page two carries different salons than page one, so it is its
 *             own indexable page with a self-referencing canonical. (rel=prev/next is not
 *             used -- Google stopped supporting it as an indexing signal in 2019; a
 *             self-canonical per page plus a followable "next" link is the current guidance.)
 *
 * Built from runtimeConfig.public.siteUrl rather than useRequestURL().origin -- see
 * utils/canonical-url.ts for why a canonical in particular must not be request-derived.
 */
const canonicalUrl = computed(() =>
  buildCanonicalUrl(config.public.siteUrl, '/salons', {
    gender: gender.value === 'men' ? 'men' : undefined,
    city: requestedCitySlug.value || undefined,
    cursor: cursor.value || undefined,
  }),
)

useSeoMeta({
  title: () => `${heading.value} | قیچی`,
  description,
  ogTitle: () => heading.value,
  ogDescription: description,
  ogType: 'website',
  ogUrl: () => canonicalUrl.value,
})

useHead({
  link: [{ rel: 'canonical', href: () => canonicalUrl.value }],
  script: [
    {
      type: 'application/ld+json',
      // The < escaping matters: JSON.stringify does NOT escape a closing script tag -- same
      // guard as the home, salon and blog pages' own JSON-LD blocks. City names come from the
      // seeded cities table rather than user input, but the escape is unconditional here for
      // the same reason it is there: it must not depend on anyone re-checking the source.
      innerHTML: () =>
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'خانه', item: buildCanonicalUrl(config.public.siteUrl, '/') },
            { '@type': 'ListItem', position: 2, name: 'سالن‌ها', item: buildCanonicalUrl(config.public.siteUrl, '/salons') },
            // Third crumb only on an explicitly-requested city, so it matches the canonical:
            // the default-city page IS /salons, and claiming a deeper trail for it would
            // describe a hierarchy level that has no url of its own.
            ...(requestedCitySlug.value
              ? [{ '@type': 'ListItem', position: 3, name: heading.value, item: canonicalUrl.value }]
              : []),
          ],
        }).replace(/[<]/g, '\\u003c'),
    },
  ],
})
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-4 p-4 lg:max-w-5xl lg:p-6">
    <!-- Three-way, and every branch matters:
         - a resolved city renders the page;
         - no city AND no city table means GET /cities itself failed, which must surface as
           the error card rather than as a blank screen (the in-page error card below lives
           inside this branch's own subtree and can't cover a failure that happens upstream
           of it);
         - no city WITH a city table is the unknown-slug 404 thrown in setup -- rendering
           nothing is the correct outcome there. `throw createError` does not abort the render
           pass, so this guard is what stops the template running against a null activeCity
           during Suspense's pre-render and crashing over the top of the real 404 (same
           pattern as salons/[slug].vue and the booking page). -->
    <template v-if="activeCity">
      <!-- A real <nav> of real links, not a decorative trail: it mirrors the BreadcrumbList
           JSON-LD above and gives the crawler an internal link back up from every facet page. -->
      <nav aria-label="مسیر صفحه" class="text-xs text-(--color-text-muted)">
        <NuxtLink to="/" class="hover:text-(--color-text)">خانه</NuxtLink>
        <span aria-hidden="true" class="mx-1.5">/</span>
        <NuxtLink to="/salons" class="hover:text-(--color-text)">سالن‌ها</NuxtLink>
      </nav>

      <h1 class="text-xl font-bold text-(--color-text)">{{ heading }}</h1>

      <!-- Links, not buttons. This is the whole discovery mechanism: a crawler that can only
           reach the women's listing would never see a single men's salon, and `gender` has no
           other source on a page with no session. Same segmented-control styling as the home
           page's own sort/view toggles, so the visual language is unchanged. -->
      <nav class="inline-flex rounded-full bg-(--color-surface-subtle) p-1 text-sm" aria-label="جنسیت سالن">
        <NuxtLink
          :to="browseLink({ gender: 'women', cursor: null })"
          :aria-current="gender === 'women' ? 'page' : undefined"
          class="min-h-8 rounded-full px-4 py-1.5 transition-colors"
          :class="gender === 'women' ? 'bg-(--color-surface-card) font-semibold text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
        >
          زنانه
        </NuxtLink>
        <NuxtLink
          :to="browseLink({ gender: 'men', cursor: null })"
          :aria-current="gender === 'men' ? 'page' : undefined"
          class="min-h-8 rounded-full px-4 py-1.5 transition-colors"
          :class="gender === 'men' ? 'bg-(--color-surface-card) font-semibold text-(--color-text) shadow-(--shadow-sm)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
        >
          مردانه
        </NuxtLink>
      </nav>

      <p v-if="pending" data-testid="browse-loading" role="status" class="py-8 text-center text-sm text-(--color-text-muted)">
        در حال بارگذاری...
      </p>
      <div
        v-else-if="failed"
        data-testid="browse-error"
        role="alert"
        class="flex flex-col items-center gap-3 rounded-2xl border border-(--color-danger-soft) bg-(--color-danger-soft) p-6 text-center"
      >
        <BaseIcon name="alert-circle" :size="20" class="text-(--color-danger)" />
        <p class="text-sm text-(--color-text)">مشکلی در بارگذاری سالن‌ها پیش آمد.</p>
        <BaseButton variant="secondary" size="md" @click="refreshNuxtData('salons-browse')">تلاش دوباره</BaseButton>
      </div>
      <p v-else-if="!salons.length" data-testid="browse-empty" class="py-8 text-center text-sm text-(--color-text-muted)">
        هنوز سالن {{ genderLabel }} تایید‌شده‌ای در {{ cityName }} ثبت نشده است.
      </p>
      <!-- SalonCard renders a NuxtLink to /salons/<slug>, which SSRs as a real <a href> -- the
           one thing this whole page exists to put into the server-rendered html. -->
      <div v-else data-testid="browse-results" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SalonCard v-for="salon in salons" :key="salon.id" :salon="salon" />
      </div>

      <!-- An <a>, not a button: a "load more" that only exists as a click handler is invisible
           to a crawler, so page two's salons would be unreachable by internal link. -->
      <nav v-if="nextCursor" class="flex justify-center pt-2" aria-label="صفحه‌بندی">
        <NuxtLink
          :to="browseLink({ cursor: nextCursor })"
          data-testid="browse-next"
          rel="next"
          class="min-h-9 rounded-full border border-(--color-border) bg-(--color-surface-card) px-5 py-2 text-sm text-(--color-text) transition-colors hover:bg-(--color-surface-subtle)"
        >
          صفحه بعد
        </NuxtLink>
      </nav>

      <!-- The crawl frontier. Every city is one hop from here, and every city page is one hop
           from its own salons, so the full approved catalogue is reachable by following links
           from /salons alone -- which is what the sitemap could never establish on its own. -->
      <section class="space-y-2 border-t border-(--color-border) pt-4">
        <h2 class="text-sm font-bold text-(--color-text)">سالن‌های زیبایی در سایر شهرها</h2>
        <div class="flex flex-wrap gap-1.5">
          <NuxtLink
            v-for="city in cities"
            :key="city.id"
            :to="browseLink({ city: city.slug, cursor: null })"
            :aria-current="city.id === activeCity.id ? 'page' : undefined"
            class="rounded-full border border-(--color-border) px-3 py-1 text-xs transition-colors"
            :class="city.id === activeCity.id
              ? 'bg-(--color-surface-subtle) font-semibold text-(--color-text)'
              : 'bg-(--color-surface-card) text-(--color-text-muted) hover:text-(--color-text)'"
          >
            {{ city.name }}
          </NuxtLink>
        </div>
      </section>
    </template>

    <div
      v-else-if="!cities?.length"
      data-testid="browse-error"
      role="alert"
      class="flex flex-col items-center gap-3 rounded-2xl border border-(--color-danger-soft) bg-(--color-danger-soft) p-6 text-center"
    >
      <BaseIcon name="alert-circle" :size="20" class="text-(--color-danger)" />
      <p class="text-sm text-(--color-text)">مشکلی در بارگذاری فهرست شهرها پیش آمد.</p>
      <!-- Only the city table is refreshed: once it repopulates, activeCity flips from null to
           a real city, which the search entry watches and refetches off. -->
      <BaseButton variant="secondary" size="md" @click="refreshNuxtData('public-cities')">تلاش دوباره</BaseButton>
    </div>
  </div>
</template>
