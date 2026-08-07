import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
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
