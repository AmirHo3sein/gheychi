import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reactive } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import SalonsBrowsePage from '../../app/pages/salons/index.vue'

// Same harness shape as blog-index.spec.ts: this page drives every facet off route.query, and
// the real Nuxt test router doesn't re-navigate reliably for a query-only change against a
// component mounted without its route registered -- so useRoute is pinned to a minimal,
// directly-controllable object. Unlike the blog list, nothing here calls router.push (every
// facet is a real <a>, which is the entire point of the page), so no router stub is needed.
const mockRoute = reactive<{ query: Record<string, string> }>({ query: {} })
mockNuxtImport('useRoute', () => () => mockRoute)

const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const CITIES = [
  { id: 1, name: 'تهران', slug: 'tehran', province: 'تهران', lat: 35.6892, lng: 51.389 },
  { id: 2, name: 'مشهد', slug: 'mashhad', province: 'خراسان رضوی', lat: 36.2605, lng: 59.6168 },
]

function salon(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's1',
    name: 'سالن نمونه',
    slug: 'salon-nemune',
    city: 'تهران',
    address: 'خیابان ولیعصر',
    ratingAvg: 4.5,
    ratingCount: 12,
    distanceKm: 1.2,
    minPrice: 150000,
    coverPhoto: null,
    isFeatured: false,
    hasActiveStory: false,
    categories: [],
    ...overrides,
  }
}

/** Dispatch by url -- the page fetches the city table and the search results in one setup. */
function stubSearch(page: { items: unknown[]; nextCursor: string | null; hasMore: boolean } | 'fail') {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/cities') return CITIES
    if (path === '/search') {
      if (page === 'fail') throw { response: { status: 500 }, data: { message: 'boom' } }
      return page
    }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('public salon browse listing', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    // mountSuspended shares one Nuxt app instance across tests in this file; without an
    // explicit unmount the previous test's component keeps reacting to mockRoute mutations.
    wrapper?.unmount()
    fetchMock.mockReset()
    mockRoute.query = {}
    vi.stubGlobal('$fetch', fetchStub)
    // useAsyncData's payload cache would otherwise serve the previous test's response.
    clearNuxtData(['public-cities', 'salons-browse'])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // The reason this page exists: an anonymous visitor must receive real, followable salon
  // links in the rendered markup, with no session anywhere in the request.
  it('renders a real anchor href to each salon profile with no session', async () => {
    stubSearch({ items: [salon(), salon({ id: 's2', slug: 'dovom', name: 'سالن دوم' })], nextCursor: null, hasMore: false })
    wrapper = await mountSuspended(SalonsBrowsePage)

    expect(wrapper.find('a[href="/salons/salon-nemune"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/salons/dovom"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="browse-results"]').exists()).toBe(true)
  })

  it('sends the required public /search params (gender + the city centroid) without a session', async () => {
    stubSearch({ items: [salon()], nextCursor: null, hasMore: false })
    wrapper = await mountSuspended(SalonsBrowsePage)

    const searchCall = fetchMock.mock.calls.find((c) => c[0] === '/search')!
    expect(searchCall[1].query).toMatchObject({ gender: 'women', lat: CITIES[0]!.lat, lng: CITIES[0]!.lng })
    // Browsing a whole city ranks by rating, not by distance from an arbitrary centroid.
    expect(searchCall[1].query.sort).toBe('rating')
  })

  // gender has no anonymous default in the API, so a crawler that can't reach the men's
  // variant would never discover a single men's salon.
  it('links both gender facets as anchors and keeps the city while switching', async () => {
    mockRoute.query = { city: 'mashhad' }
    stubSearch({ items: [salon()], nextCursor: null, hasMore: false })
    wrapper = await mountSuspended(SalonsBrowsePage)

    expect(wrapper.find('a[href="/salons?gender=men&city=mashhad"]').exists()).toBe(true)
    // The women's variant is the default, so it carries no redundant gender param.
    expect(wrapper.find('a[href="/salons?city=mashhad"]').exists()).toBe(true)
  })

  it('honours an explicit gender param when querying and keeps it on the city links', async () => {
    mockRoute.query = { gender: 'men' }
    stubSearch({ items: [salon()], nextCursor: null, hasMore: false })
    wrapper = await mountSuspended(SalonsBrowsePage)

    const searchCall = fetchMock.mock.calls.find((c) => c[0] === '/search')!
    expect(searchCall[1].query.gender).toBe('men')
    expect(wrapper.find('a[href="/salons?gender=men&city=mashhad"]').exists()).toBe(true)
  })

  it('renders every city as an anchor -- the crawl frontier into all other cities', async () => {
    stubSearch({ items: [salon()], nextCursor: null, hasMore: false })
    wrapper = await mountSuspended(SalonsBrowsePage)

    expect(wrapper.find('a[href="/salons?city=tehran"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/salons?city=mashhad"]').exists()).toBe(true)
  })

  it('resolves a requested city slug rather than always using the default', async () => {
    mockRoute.query = { city: 'mashhad' }
    stubSearch({ items: [salon()], nextCursor: null, hasMore: false })
    wrapper = await mountSuspended(SalonsBrowsePage)

    const searchCall = fetchMock.mock.calls.find((c) => c[0] === '/search')!
    expect(searchCall[1].query).toMatchObject({ lat: CITIES[1]!.lat, lng: CITIES[1]!.lng })
    expect(wrapper.text()).toContain('مشهد')
  })

  // A silent fallback would serve identical content under unlimited invented ?city= urls.
  it('404s on an unknown city slug instead of falling back to the default city', async () => {
    mockRoute.query = { city: 'not-a-real-city' }
    stubSearch({ items: [], nextCursor: null, hasMore: false })

    await expect(mountSuspended(SalonsBrowsePage)).rejects.toMatchObject({ statusCode: 404 })
    wrapper = undefined
  })

  // "Next" must be an anchor: a click-only "load more" leaves page two's salons unreachable
  // by any internal link.
  it('renders the next page as a followable anchor carrying the server-issued cursor', async () => {
    mockRoute.query = { gender: 'men' }
    stubSearch({ items: [salon()], nextCursor: 'eyJwYWdlIjoyfQ', hasMore: true })
    wrapper = await mountSuspended(SalonsBrowsePage)

    const next = wrapper.find('[data-testid="browse-next"]')
    expect(next.exists()).toBe(true)
    expect(next.attributes('href')).toBe('/salons?gender=men&cursor=eyJwYWdlIjoyfQ')
  })

  it('round-trips an incoming cursor to the API and omits the next link on the last page', async () => {
    mockRoute.query = { cursor: 'eyJwYWdlIjoyfQ' }
    stubSearch({ items: [salon()], nextCursor: null, hasMore: false })
    wrapper = await mountSuspended(SalonsBrowsePage)

    const searchCall = fetchMock.mock.calls.find((c) => c[0] === '/search')!
    expect(searchCall[1].query.cursor).toBe('eyJwYWdlIjoyfQ')
    expect(wrapper.find('[data-testid="browse-next"]').exists()).toBe(false)
  })

  it('shows the empty state -- not the error state -- when the city genuinely has no salons', async () => {
    stubSearch({ items: [], nextCursor: null, hasMore: false })
    wrapper = await mountSuspended(SalonsBrowsePage)

    expect(wrapper.find('[data-testid="browse-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="browse-error"]').exists()).toBe(false)
    // The city crawl frontier still renders, so an empty city is never a dead end.
    expect(wrapper.find('a[href="/salons?city=mashhad"]').exists()).toBe(true)
  })

  it('shows the error state -- not the empty state -- when /search fails', async () => {
    stubSearch('fail')
    wrapper = await mountSuspended(SalonsBrowsePage)

    const error = wrapper.find('[data-testid="browse-error"]')
    expect(error.exists()).toBe(true)
    expect(error.attributes('role')).toBe('alert')
    expect(wrapper.find('[data-testid="browse-empty"]').exists()).toBe(false)
  })

  // The city table gates the whole page (no city -> no lat/lng -> no legal /search call), so
  // its failure has to surface as the error card and not as a blank screen -- the in-page
  // error card lives inside the resolved-city subtree and can't cover a failure above it.
  it('shows the error state rather than rendering blank when /cities fails', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/cities') throw { response: { status: 500 }, data: { message: 'boom' } }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    wrapper = await mountSuspended(SalonsBrowsePage)

    expect(wrapper.find('[data-testid="browse-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('شهرها')
    // /search is never called: there is no legal request to make without a coordinate pair.
    expect(fetchMock.mock.calls.some((c) => c[0] === '/search')).toBe(false)
  })

  it('emits a self-referencing canonical built from the configured site url, not the request', async () => {
    mockRoute.query = { gender: 'men', city: 'mashhad' }
    stubSearch({ items: [salon()], nextCursor: null, hasMore: false })
    wrapper = await mountSuspended(SalonsBrowsePage)

    // Head DOM writes are debounced by unhead, so poll rather than asserting synchronously.
    await vi.waitFor(() => {
      const canonical = document.head.querySelector('link[rel="canonical"]')
      expect(canonical?.getAttribute('href')).toBe('http://localhost:3003/salons?gender=men&city=mashhad')
    })
  })

  // ?gender=nonsense renders the women's listing; the canonical must fold it away rather than
  // minting an indexable duplicate for every junk value.
  it('canonicalises defaulted and junk facet values back to the bare listing url', async () => {
    mockRoute.query = { gender: 'nonsense' }
    stubSearch({ items: [salon()], nextCursor: null, hasMore: false })
    wrapper = await mountSuspended(SalonsBrowsePage)

    await vi.waitFor(() => {
      const canonical = document.head.querySelector('link[rel="canonical"]')
      expect(canonical?.getAttribute('href')).toBe('http://localhost:3003/salons')
    })
  })

  it('renders a breadcrumb trail as real links plus matching BreadcrumbList JSON-LD', async () => {
    stubSearch({ items: [salon()], nextCursor: null, hasMore: false })
    wrapper = await mountSuspended(SalonsBrowsePage)

    const crumbs = wrapper.find('nav[aria-label="مسیر صفحه"]')
    expect(crumbs.exists()).toBe(true)
    expect(crumbs.find('a[href="/"]').exists()).toBe(true)

    await vi.waitFor(() => {
      const ld = [...document.head.querySelectorAll('script[type="application/ld+json"]')]
        .map((el) => JSON.parse(el.textContent ?? '{}'))
        .find((json) => json['@type'] === 'BreadcrumbList')
      expect(ld).toBeDefined()
      expect(ld.itemListElement[0]).toMatchObject({ position: 1, item: 'http://localhost:3003/' })
      expect(ld.itemListElement[1]).toMatchObject({ position: 2, item: 'http://localhost:3003/salons' })
    })
  })
})
