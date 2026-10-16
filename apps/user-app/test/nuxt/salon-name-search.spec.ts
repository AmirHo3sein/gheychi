import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import SalonNameSearch from '../../app/components/salon/SalonNameSearch.vue'

const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), { create: () => fetchStub })

const CONTEXT = { lat: 35.7, lng: 51.4, gender: 'women' as const }

function salon(id: string, name: string, extra: Record<string, unknown> = {}) {
  return { id, slug: id, name, city: 'تهران', address: 'ونک', coverPhoto: null, ratingAvg: 4.5, ratingCount: 12, distanceKm: 1, minPrice: null, categories: [], isFeatured: false, hasActiveStory: false, ...extra }
}

enableAutoUnmount(afterEach)

async function mountField(props: Record<string, unknown> = { context: CONTEXT }) {
  const wrapper = await mountSuspended(SalonNameSearch, { props: { modelValue: '', ...props, 'onUpdate:modelValue': (v: string) => wrapper.setProps({ modelValue: v }) } })
  return wrapper
}

async function type(wrapper: Awaited<ReturnType<typeof mountField>>, value: string) {
  const input = wrapper.get('[data-testid="home-search-input"]')
  await input.trigger('focus')
  await input.setValue(value)
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
}

describe('SalonNameSearch type-ahead', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('describes a business search, not only «سالن»', async () => {
    const wrapper = await mountField()
    expect(wrapper.get('[data-testid="home-search-input"]').attributes('placeholder')).toBe('نام سالن، آرایشگاه یا کسب‌وکار')
  })

  it('shows matching salons in a card under the field, with the typed part marked', async () => {
    fetchMock.mockResolvedValue({ items: [salon('star', 'سالن زیبایی ستاره'), salon('star2', 'آرایشگاه ستاره', { isFeatured: true })] })
    const wrapper = await mountField()
    await type(wrapper, 'ستاره')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/search/suggestions')
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ query: { q: 'ستاره', lat: 35.7, lng: 51.4, gender: 'women' } })

    const panel = wrapper.get('[data-testid="search-suggestions"]')
    const rows = panel.findAll('[data-testid="search-suggestion"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.get('mark').text()).toBe('ستاره')
    expect(rows[0]!.get('a').attributes('href')).toBe('/salons/star')
    // A paid placement is labelled here exactly as on the result cards.
    expect(rows[1]!.text()).toContain('تبلیغ')
    expect(wrapper.get('[data-testid="home-search-input"]').attributes('aria-expanded')).toBe('true')
  })

  it('waits for a pause in typing: one request for a burst of keystrokes', async () => {
    fetchMock.mockResolvedValue({ items: [] })
    const wrapper = await mountField()
    const input = wrapper.get('[data-testid="home-search-input"]')
    await input.trigger('focus')
    for (const v of ['سا', 'سال', 'سالن']) {
      await input.setValue(v)
      await vi.advanceTimersByTimeAsync(100)
    }
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ query: { q: 'سالن' } })
  })

  it('asks for nothing under two letters, without a search context, or when the field is not focused', async () => {
    fetchMock.mockResolvedValue({ items: [] })
    const wrapper = await mountField()
    await type(wrapper, 'س')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="home-search-input"]').attributes('aria-expanded')).toBe('false')

    const noContext = await mountField({ context: null })
    await type(noContext, 'ستاره')
    expect(fetchMock).not.toHaveBeenCalled()

    const unfocused = await mountField()
    await unfocused.get('[data-testid="home-search-input"]').setValue('ستاره')
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says so when nothing matches, and still offers the full search', async () => {
    fetchMock.mockResolvedValue({ items: [] })
    const wrapper = await mountField()
    await type(wrapper, 'ناموجود')
    expect(wrapper.get('[data-testid="search-suggestions-empty"]').text()).toContain('«ناموجود»')
    await wrapper.get('[data-testid="search-suggestions-all"] button').trigger('click')
    expect(wrapper.emitted('submit')).toHaveLength(1)
    await nextTick()
    expect(wrapper.get('[data-testid="home-search-input"]').attributes('aria-expanded')).toBe('false')
  })

  it('moves through the options with the arrow keys and opens the chosen salon on Enter', async () => {
    fetchMock.mockResolvedValue({ items: [salon('a', 'سالن الف'), salon('b', 'سالن ب')] })
    const wrapper = await mountField()
    await type(wrapper, 'سالن')
    const input = wrapper.get('[data-testid="home-search-input"]')
    const push = vi.spyOn(useRouter(), 'push').mockResolvedValue(undefined)

    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    const activeId = input.attributes('aria-activedescendant')!
    expect(wrapper.get(`#${CSS.escape(activeId)}`).text()).toContain('سالن ب')

    await wrapper.get('[data-testid="home-search"]').trigger('submit')
    expect(push).toHaveBeenCalledWith('/salons/b')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('submits the typed text on Enter when no suggestion is highlighted, and Escape closes the card', async () => {
    fetchMock.mockResolvedValue({ items: [salon('a', 'سالن الف')] })
    const wrapper = await mountField()
    await type(wrapper, 'سالن')
    const input = wrapper.get('[data-testid="home-search-input"]')

    expect(input.attributes('aria-expanded')).toBe('true')
    await input.trigger('keydown', { key: 'Escape' })
    expect(input.attributes('aria-expanded')).toBe('false')

    await wrapper.get('[data-testid="home-search"]').trigger('submit')
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('never shows an older term\'s results under a newer term', async () => {
    let resolveFirst: (v: unknown) => void = () => {}
    fetchMock
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
      .mockResolvedValueOnce({ items: [salon('new', 'سالن ماه')] })
    const wrapper = await mountField()
    await type(wrapper, 'ستاره')
    await type(wrapper, 'ماه')
    resolveFirst({ items: [salon('old', 'سالن ستاره')] })
    await flushPromises()
    const rows = wrapper.findAll('[data-testid="search-suggestion"]')
    expect(rows.map((r) => r.text()).join()).toContain('ماه')
    expect(rows.map((r) => r.text()).join()).not.toContain('ستاره')
  })
})
