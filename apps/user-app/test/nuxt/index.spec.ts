import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockComponent, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import Multiselect from 'vue-multiselect'
import IndexPage from '../../app/pages/index.vue'
import { useSessionStore } from '../../app/stores/session'

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

const USER = { id: 'u1', phone: '09120000000', name: 'Test', gender: 'female' as const, role: 'customer' as const }

function stub() {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/categories') return []
    if (path === '/cities') return [{ name: 'تهران', lat: 35.6892, lng: 51.389 }]
    if (path === '/search') return { items: [], nextCursor: null, hasMore: false }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

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
})
