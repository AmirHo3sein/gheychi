import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockComponent, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import Multiselect from 'vue-multiselect'
import IndexPage from '../../app/pages/index.vue'
import { useSessionStore } from '../../app/stores/session'
import { FEATURE_FLAGS_STATE_KEY } from '../../app/composables/useFeatureFlags'

// Same pattern as profile.spec.ts / login.spec.ts: `$fetch` is a real globalThis binding,
// not an unimport-tracked auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

// The real SalonMap lazily imports Leaflet. Nothing here tests the map itself, and that dynamic
// import could finish AFTER the test environment was torn down ("window is not defined" from
// leaflet/src/core/Util.js -- an intermittent unhandled rejection that failed the whole run).
mockComponent('SalonMap', { template: '<div data-testid="salon-map-stub" />' })

function salon(id: string, name = `سالن ${id}`) {
  return { id, slug: id, name, city: 'تهران', coverPhoto: null, ratingAvg: 0, ratingCount: 0, distanceKm: 1, minPrice: 100000, categories: [], isFeatured: false, hasActiveStory: false }
}

function setBeautyGuide(on: boolean) {
  const flags = useState<Record<string, boolean>>(FEATURE_FLAGS_STATE_KEY)
  flags.value = { ...(flags.value ?? {}), beautyGuideEnabled: on }
}

const USER = { id: 'u1', phone: '09120000000', name: 'Test', gender: 'female' as const, role: 'customer' as const }

function stub() {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/categories') return []
    if (path === '/cities') return [{ name: 'تهران', lat: 35.6892, lng: 51.389 }]
    if (path === '/search') return { items: [], nextCursor: null, hasMore: false }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

// Each test switches the session user; a previous test's still-mounted page would re-render
// against that shared store after its DOM is gone (the hero/heading branches swap on login).
enableAutoUnmount(afterEach)

describe('home page', () => {
  beforeEach(() => {
    // The server-rendered first page is cached by key for the lifetime of the Nuxt app; each test must start cold.
    clearNuxtData('home-initial-search')
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    useSessionStore().$reset()
    useSessionStore().setUser(USER)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('searches with the salon-target gender mapped from the user own gender', async () => {
    stub()
    await mountSuspended(IndexPage)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/search', expect.objectContaining({ query: expect.objectContaining({ gender: 'women' }) }))
  })

  // The search only needs the default coordinates + gender. Chaining it behind the category and city
  // lists added a full round trip before the page's largest paint (the first salon) could be requested.
  it('requests the salons without waiting for the category and city lists', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path === '/categories' || path === '/cities') return new Promise(() => {}) // never resolves
      if (path === '/search') return Promise.resolve({ items: [], nextCursor: null, hasMore: false })
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    await mountSuspended(IndexPage)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/search', expect.anything())
  })

  // The first page is server-rendered with the same parameters the client would use, so mounting must not fire
  // that search a second time -- that duplicate was exactly the post-hydration round trip this removes.
  it('uses the server-rendered first page instead of searching again after mount, with a bounded wait', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/categories') return []
      if (path === '/cities') return [{ name: 'تهران', lat: 35.6892, lng: 51.389 }]
      if (path === '/search') return { items: [{ id: 's1', slug: 's1', name: 'سالن نمونه', city: 'تهران', coverPhoto: null, ratingAvg: 0, ratingCount: 0, distanceKm: 1, minPrice: 100000, categories: [], isFeatured: false, hasActiveStory: false }], nextCursor: null, hasMore: false }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    const searches = fetchMock.mock.calls.filter(([p]) => p === '/search')
    expect(searches).toHaveLength(1)
    expect(searches[0]![1]).toMatchObject({ timeout: 3000 })
    expect(wrapper.text()).toContain('سالن نمونه')
    expect(wrapper.find('[data-testid="salons-loading"]').exists()).toBe(false)
  })

  it('falls back to a client-side search after mount when the server-rendered one failed', async () => {
    let n = 0
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/categories') return []
      if (path === '/cities') return [{ name: 'تهران', lat: 35.6892, lng: 51.389 }]
      if (path === '/search') { if (++n === 1) throw new Error('boom'); return { items: [], nextCursor: null, hasMore: false } }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    expect(fetchMock.mock.calls.filter(([p]) => p === '/search')).toHaveLength(2)
    expect(wrapper.find('[data-testid="salons-empty"]').exists()).toBe(true) // recovered, not stuck on the error card
  })

  it('asks an account with no gender to complete its profile instead of firing a request that can only 400', async () => {
    // /search's `gender` param is required, so with gender = null ofetch drops the param and
    // the API 400s -- which used to render the generic "something went wrong" card whose
    // retry button re-issued the very same invalid request, forever.
    useSessionStore().setUser({ ...USER, gender: null })
    stub()
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalledWith('/search', expect.anything())
    const prompt = wrapper.find('[data-testid="needs-profile"]')
    expect(prompt.exists()).toBe(true)
    expect(prompt.find('a').attributes('href')).toBe('/profile')
    // Specifically NOT the retry-forever error card.
    expect(wrapper.text()).not.toContain('مشکلی در بارگذاری سالن‌ها پیش آمد')
  })

  // `/` is a public route. An anonymous visitor used to hit a login wall with NO results (the
  // API's /search requires a gender and only an account carries one), which hid the whole
  // catalogue from first-time visitors and crawlers. They now browse women's salons by default
  // and can switch to men's; login is only asked for at booking time.
  it('shows an anonymous visitor real results (women\'s salons by default) instead of a login wall', async () => {
    useSessionStore().$reset()
    useSessionStore().setUser(null)
    stub()
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    expect(wrapper.find('[data-testid="needs-login"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="needs-profile"]').exists()).toBe(false)
    const searchCall = fetchMock.mock.calls.find(([path]) => path === '/search')
    expect(searchCall?.[1]).toMatchObject({ query: expect.objectContaining({ gender: 'women' }) })
    expect(wrapper.text()).not.toContain('مشکلی در بارگذاری سالن‌ها پیش آمد')
  })

  it('lets an anonymous visitor switch to men\'s salons, which re-runs the search', async () => {
    useSessionStore().$reset()
    useSessionStore().setUser(null)
    stub()
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()
    fetchMock.mockClear()

    await wrapper.findAll('[data-testid="anon-gender"] button').find((b) => b.text() === 'آقایان')!.trigger('click')
    await flushPromises()

    const searchCall = fetchMock.mock.calls.find(([path]) => path === '/search')
    expect(searchCall?.[1]).toMatchObject({ query: expect.objectContaining({ gender: 'men' }) })
  })

  it('does not offer the gender switch to a logged-in customer (their results follow their profile)', async () => {
    stub()
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="anon-gender"]').exists()).toBe(false)
  })

  // The loading/error states used to be nested inside the list branch only, so a failed
  // (or in-flight) search gave map view no feedback at all -- just the previous pins.
  it('shows the search error and its retry in map view too', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/categories') return []
      if (path === '/cities') return [{ name: 'تهران', lat: 35.6892, lng: 51.389 }]
      if (path === '/search') throw { response: { status: 500 } }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    await wrapper.get('[aria-label="نوع نمایش"] button:last-child').trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toContain('مشکلی در بارگذاری سالن‌ها پیش آمد')
  })

  it('shows the loading state in map view while a (re-)search is in flight', async () => {
    useSessionStore().$reset()
    useSessionStore().setUser(null) // anonymous: only they get the gender switch used below to trigger a re-search
    let resolveSearch: (value: unknown) => void = () => {}
    let searches = 0
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/categories') return []
      if (path === '/cities') return [{ name: 'تهران', lat: 35.6892, lng: 51.389 }]
      // The first page is server-rendered and resolves at once; the user's NEXT search is the one left in flight.
      if (path === '/search') return ++searches === 1 ? { items: [], nextCursor: null, hasMore: false } : new Promise((resolve) => { resolveSearch = resolve })
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    await wrapper.get('[data-testid="anon-gender"] button:last-child').trigger('click') // re-runs the search, left pending
    await flushPromises()
    await wrapper.get('[aria-label="نوع نمایش"] button:last-child').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="status"]').text()).toContain('در حال بارگذاری')

    resolveSearch({ items: [], nextCursor: null, hasMore: false })
    await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })


  // The city field used to be a native <select> over a 4-city hardcoded starter list
  // (CITY_CENTERS); it's now the full backend-owned city list (GET /cities, same source
  // provider-panel's onboarding uses) through a vue-multiselect field, and picking a city
  // has to actually re-center the search, not just change the label.
  it('re-searches around the selected city\'s coordinates from the full GET /cities list', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/categories') return []
      if (path === '/cities') return [
        { name: 'تهران', lat: 35.6892, lng: 51.389 },
        { name: 'شیراز', lat: 29.5918, lng: 52.5837 },
      ]
      if (path === '/search') return { items: [], nextCursor: null, hasMore: false }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/search', expect.objectContaining({
      query: expect.objectContaining({ lat: 35.6892, lng: 51.389 }),
    }))

    // AppSelect.client.vue's own module reference doesn't match the instance Nuxt's
    // .client.vue wrapping mounts in this test environment -- vue-multiselect's own
    // Multiselect component is the stable, directly-importable thing to look up instead.
    await wrapper.findComponent(Multiselect).vm.$emit('update:modelValue', { value: 'شیراز', label: 'شیراز' })
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/search', expect.objectContaining({
      query: expect.objectContaining({ lat: 29.5918, lng: 52.5837 }),
    }))
  })

  // Hiding the category row's native scrollbar (for the snap/mask treatment) removed the
  // one signal a mouse-only desktop user had that more pills exist off-screen -- these
  // buttons are the actual way to reach them, not a decorative extra.
  it('scrolls the category row toward more content when the "more" pills button is clicked', async () => {
    stub()
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    const container = wrapper.get('[aria-label="دسته‌بندی خدمات"]').element as HTMLElement
    const scrollBySpy = vi.fn()
    container.scrollBy = scrollBySpy
    Object.defineProperty(container, 'clientWidth', { value: 300, configurable: true })

    await wrapper.get('[data-testid="categories-scroll-more"]').trigger('click')

    // 'more' reveals pills further along reading order -- visually left in this RTL row,
    // which is a further-negative scrollLeft delta in the evergreen-browser RTL convention
    // this relies on (see the component's own comment on that assumption).
    expect(scrollBySpy).toHaveBeenCalledWith({ left: -225, behavior: 'smooth' })
  })

  it('scrolls the category row back toward the start when the "back" button is clicked', async () => {
    stub()
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    const container = wrapper.get('[aria-label="دسته‌بندی خدمات"]').element as HTMLElement
    const scrollBySpy = vi.fn()
    container.scrollBy = scrollBySpy
    Object.defineProperty(container, 'clientWidth', { value: 300, configurable: true })

    await wrapper.get('[data-testid="categories-scroll-back"]').trigger('click')

    expect(scrollBySpy).toHaveBeenCalledWith({ left: 225, behavior: 'smooth' })
  })

  // --- 2026-10 redesign: hero, salon-name search, "بیشتر" pagination ---

  it('greets a logged-out visitor with the hero and a search field, and a customer without the hero', async () => {
    useSessionStore().setUser(null)
    stub()
    const anonymous = await mountSuspended(IndexPage)
    await flushPromises()
    expect(anonymous.find('[data-testid="home-hero"]').exists()).toBe(true)
    expect(anonymous.find('[data-testid="home-search-input"]').exists()).toBe(true)

    clearNuxtData('home-initial-search')
    useSessionStore().setUser(USER)
    const customer = await mountSuspended(IndexPage)
    await flushPromises()
    expect(customer.find('[data-testid="home-hero"]').exists()).toBe(false)
    expect(customer.find('[data-testid="home-search-input"]').exists()).toBe(true)
  })

  it('sends the typed salon name as the API\'s `q` param on submit (trimmed), not on every keystroke', async () => {
    stub()
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()
    fetchMock.mockClear()

    await wrapper.get('[data-testid="home-search-input"]').setValue('  ستاره ')
    await flushPromises()
    expect(fetchMock.mock.calls.filter(([p]) => p === '/search')).toHaveLength(0)

    await wrapper.get('[data-testid="home-search"]').trigger('submit')
    await flushPromises()
    const searches = fetchMock.mock.calls.filter(([p]) => p === '/search')
    expect(searches).toHaveLength(1)
    expect(searches[0]![1]).toMatchObject({ query: expect.objectContaining({ q: 'ستاره', gender: 'women' }) })
    expect(wrapper.get('[data-testid="home-search-active"]').text()).toContain('ستاره')
  })

  it('names the search in the empty state and clearing it re-runs the search without `q`', async () => {
    stub()
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    await wrapper.get('[data-testid="home-search-input"]').setValue('ناموجود')
    await wrapper.get('[data-testid="home-search"]').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-testid="salons-empty"]').text()).toContain('«ناموجود»')

    fetchMock.mockClear()
    await wrapper.get('[data-testid="home-search-clear"]').trigger('click')
    await flushPromises()
    const searches = fetchMock.mock.calls.filter(([p]) => p === '/search')
    expect(searches).toHaveLength(1)
    expect((searches[0]![1] as { query: Record<string, unknown> }).query.q).toBeUndefined()
    expect((wrapper.get('[data-testid="home-search-input"]').element as HTMLInputElement).value).toBe('')
  })

  it('offers «بیشتر» only when the API reports another page, and appends that page with the same filters plus the cursor', async () => {
    fetchMock.mockImplementation(async (path: string, opts: { query: Record<string, unknown> }) => {
      if (path === '/categories') return []
      if (path === '/cities') return [{ name: 'تهران', lat: 35.6892, lng: 51.389 }]
      if (path === '/search') {
        return opts.query.cursor === 'c2'
          ? { items: [salon('s2'), salon('s3')], nextCursor: null, hasMore: false }
          : { items: [salon('s1'), salon('s2')], nextCursor: 'c2', hasMore: true }
      }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    expect(wrapper.text()).toContain('سالن s1')
    const more = wrapper.get('[data-testid="load-more"]')
    expect(more.text()).toBe('بیشتر')

    await more.trigger('click')
    await flushPromises()

    const pageTwo = fetchMock.mock.calls.filter(([p]) => p === '/search').at(-1)!
    expect(pageTwo[1]).toMatchObject({ query: expect.objectContaining({ cursor: 'c2', gender: 'women', sort: 'distance' }) })
    // Appended, and the salon that appeared on both pages is not rendered twice.
    expect(wrapper.text()).toContain('سالن s3')
    expect(wrapper.text().split('سالن s2').length - 1).toBe(1)
    // Last page: the button goes away.
    expect(wrapper.find('[data-testid="load-more"]').exists()).toBe(false)
  })

  it('keeps the shown salons and offers a retry when the next page fails', async () => {
    fetchMock.mockImplementation(async (path: string, opts: { query: Record<string, unknown> }) => {
      if (path === '/categories') return []
      if (path === '/cities') return [{ name: 'تهران', lat: 35.6892, lng: 51.389 }]
      if (path === '/search') {
        if (opts.query.cursor) throw { response: { status: 500 } }
        return { items: [salon('s1')], nextCursor: 'c2', hasMore: true }
      }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    await wrapper.get('[data-testid="load-more"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('سالن s1')
    expect(wrapper.find('[data-testid="load-more-error"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="load-more"]').text()).toBe('تلاش دوباره')
  })

  it('drops a late «بیشتر» page when the filters changed while it was loading', async () => {
    useSessionStore().setUser(null) // anonymous: the gender switch is the filter change used below
    let resolvePageTwo: (value: unknown) => void = () => {}
    fetchMock.mockImplementation((path: string, opts: { query: Record<string, unknown> }) => {
      if (path === '/categories') return Promise.resolve([])
      if (path === '/cities') return Promise.resolve([{ name: 'تهران', lat: 35.6892, lng: 51.389 }])
      if (path === '/search') {
        if (opts.query.cursor) return new Promise((resolve) => { resolvePageTwo = resolve })
        if (opts.query.gender === 'men') return Promise.resolve({ items: [salon('m1')], nextCursor: null, hasMore: false })
        return Promise.resolve({ items: [salon('w1')], nextCursor: 'c2', hasMore: true })
      }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()

    await wrapper.get('[data-testid="load-more"]').trigger('click') // left in flight
    await wrapper.findAll('[data-testid="anon-gender"] button').find((b) => b.text() === 'آقایان')!.trigger('click')
    await flushPromises()
    resolvePageTwo({ items: [salon('w2')], nextCursor: null, hasMore: false })
    await flushPromises()

    expect(wrapper.text()).toContain('سالن m1')
    expect(wrapper.text()).not.toContain('سالن w2')
  })

  it('shows the Beauty Guide entry only while its feature flag is on', async () => {
    stub()
    setBeautyGuide(false)
    const off = await mountSuspended(IndexPage)
    await flushPromises()
    expect(off.find('[data-testid="beauty-guide-cta"]').exists()).toBe(false)

    clearNuxtData('home-initial-search')
    setBeautyGuide(true)
    const on = await mountSuspended(IndexPage)
    await flushPromises()
    expect(on.get('[data-testid="beauty-guide-cta"]').attributes('href')).toBe('/beauty-guide')
    setBeautyGuide(false)
  })

  // Distance is measured from the query's lat/lng. Without the customer's own position that is
  // the city centre, and «۰٫۰ کیلومتر» from a centroid means nothing to them -- so it only
  // appears once they have shared where they are («نزدیک من»).
  it('shows salon distance only for results searched from the customer real location', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/categories') return []
      if (path === '/cities') return [{ name: 'تهران', lat: 35.6892, lng: 51.389 }]
      if (path === '/search') return { items: [salon('s1')], nextCursor: null, hasMore: false }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    const getCurrentPosition = vi.fn((ok: (p: { coords: { latitude: number; longitude: number } }) => void) =>
      ok({ coords: { latitude: 35.7, longitude: 51.4 } }))
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } })
    const wrapper = await mountSuspended(IndexPage)
    await flushPromises()
    expect(wrapper.find('[data-testid="salon-card-distance"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('کیلومتر')

    const nearMe = wrapper.findAll('button').find((b) => b.text().includes('نزدیک من'))!
    await nearMe.trigger('click')
    await flushPromises()

    expect(getCurrentPosition).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith('/search', expect.objectContaining({ query: expect.objectContaining({ lat: 35.7, lng: 51.4 }) }))
    expect(wrapper.get('[data-testid="salon-card-distance"]').text()).toContain('کیلومتر')
  })

  describe('radius and price filters', () => {
    const searches = () => fetchMock.mock.calls.filter(([p]) => p === '/search').map(([, o]) => (o as { query: Record<string, unknown> }).query)

    async function openFilters() {
      stub()
      const wrapper = await mountSuspended(IndexPage)
      await flushPromises()
      fetchMock.mockClear()
      await wrapper.get('[data-testid="filters-toggle"]').trigger('click')
      return wrapper
    }

    it('sends nothing extra by default, and applies radius + price in ONE search only on «اعمال»', async () => {
      stub()
      const wrapper0 = await mountSuspended(IndexPage)
      await flushPromises()
      const first = searches()[0]!
      expect(first.radiusKm).toBeUndefined()
      expect(first.priceMin).toBeUndefined()
      wrapper0.unmount()

      const wrapper = await openFilters()
      expect(wrapper.get('[data-testid="filters-toggle"]').attributes('aria-expanded')).toBe('true')
      await wrapper.get('[data-testid="radius-5"]').trigger('click')
      await wrapper.get('[data-testid="price-min"]').setValue('۲۰۰۰۰۰')
      await wrapper.get('[data-testid="price-max"]').setValue('1,500,000')
      await flushPromises()
      expect(searches()).toHaveLength(0) // a draft, not a search per keystroke

      await wrapper.get('[data-testid="search-filters"]').trigger('submit')
      await flushPromises()
      expect(searches()).toHaveLength(1)
      expect(searches()[0]).toMatchObject({ radiusKm: 5, priceMin: 200000, priceMax: 1500000 })
      expect(wrapper.find('[data-testid="search-filters"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="filters-count"]').text()).toContain('۲')
      expect(wrapper.get('[data-testid="chip-radius"]').text()).toContain('۵')
      expect(wrapper.get('[data-testid="chip-price"]').text()).toContain('۲۰۰٬۰۰۰ تا ۱٬۵۰۰٬۰۰۰ تومان')
    })

    it('refuses a minimum above the maximum without searching', async () => {
      const wrapper = await openFilters()
      await wrapper.get('[data-testid="price-min"]').setValue('900000')
      await wrapper.get('[data-testid="price-max"]').setValue('100000')
      expect(wrapper.get('[data-testid="price-error"]').text()).toContain('حداقل قیمت')
      expect(wrapper.get('[data-testid="filters-apply"]').attributes('disabled')).toBeDefined()
      await wrapper.get('[data-testid="search-filters"]').trigger('submit')
      await flushPromises()
      expect(searches()).toHaveLength(0)
    })

    it('shows the over-maximum error for a pasted 11-digit price instead of silently cutting it down', async () => {
      const wrapper = await openFilters()
      await wrapper.get('[data-testid="price-max"]').setValue('10,000,000,000')
      expect(wrapper.get('[data-testid="price-error"]').text()).toContain('حداکثر قیمت')
      expect(wrapper.get('[data-testid="filters-apply"]').attributes('disabled')).toBeDefined()
    })

    it('removing a chip re-runs the search without that filter; the empty state offers to clear them', async () => {
      const wrapper = await openFilters()
      await wrapper.get('[data-testid="radius-3"]').trigger('click')
      await wrapper.get('[data-testid="price-max"]').setValue('500000')
      await wrapper.get('[data-testid="search-filters"]').trigger('submit')
      await flushPromises()
      expect(wrapper.find('[data-testid="empty-clear-filters"]').exists()).toBe(true)

      fetchMock.mockClear()
      await wrapper.get('[data-testid="chip-price"]').trigger('click')
      await flushPromises()
      expect(searches()).toHaveLength(1)
      expect(searches()[0]).toMatchObject({ radiusKm: 3 })
      expect(searches()[0]!.priceMax).toBeUndefined()

      fetchMock.mockClear()
      await wrapper.get('[data-testid="empty-clear-filters"]').trigger('click')
      await flushPromises()
      expect(searches()[0]!.radiusKm).toBeUndefined()
      expect(wrapper.find('[data-testid="active-filters"]').exists()).toBe(false)
    })

    it('«بیشتر» repeats the applied filters with the cursor', async () => {
      fetchMock.mockImplementation(async (path: string, opts: { query: Record<string, unknown> }) => {
        if (path === '/categories') return []
        if (path === '/cities') return []
        if (path === '/search') return opts.query.cursor ? { items: [salon('b')], nextCursor: null, hasMore: false } : { items: [salon('a')], nextCursor: 'c2', hasMore: true }
        throw new Error(path)
      })
      const wrapper = await mountSuspended(IndexPage)
      await flushPromises()
      await wrapper.get('[data-testid="filters-toggle"]').trigger('click')
      await wrapper.get('[data-testid="radius-25"]').trigger('click')
      await wrapper.get('[data-testid="search-filters"]').trigger('submit')
      await flushPromises()
      fetchMock.mockClear()
      await wrapper.get('[data-testid="load-more"]').trigger('click')
      await flushPromises()
      expect(searches()[0]).toMatchObject({ radiusKm: 25, cursor: 'c2' })
    })
  })
})
