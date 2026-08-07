import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import FavoritesPage from '../../app/pages/account/favorites.vue'

const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const SALON_WITH_PHOTO = {
  id: 's1',
  name: 'سالن زیبایی ستاره',
  slug: 'setareh-beauty',
  city: 'تهران',
  ratingAvg: 4.6,
  ratingCount: 12,
  coverPhoto: 'https://cdn.example/setareh.jpg',
  categories: [{ id: 1, name: 'کوتاهی مو', icon: 'scissors' }],
}

const SALON_NO_PHOTO = {
  id: 's2',
  name: 'سالن بدون عکس',
  slug: 'no-photo-salon',
  city: 'مشهد',
  ratingAvg: 0,
  ratingCount: 0,
  coverPhoto: null,
  categories: [],
}

function stub(items: unknown[]) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/favorites') return items
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('account favorites page', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    // mountSuspended shares one Nuxt app instance across tests in this file, so the
    // 'favorites' useAsyncData payload cache would otherwise leak the first test's
    // response into the second mount instead of re-fetching -- same reasoning as
    // account-wallet.spec.ts's clearNuxtData call.
    clearNuxtData(['favorites'])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists saved salons with photo, category badges, and rating', async () => {
    stub([SALON_WITH_PHOTO])
    const wrapper = await mountSuspended(FavoritesPage)
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="favorite-salon"]')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain('سالن زیبایی ستاره')
    expect(rows[0]!.text()).toContain('تهران')
    expect(rows[0]!.text()).toContain('کوتاهی مو')
    expect(rows[0]!.text()).toContain('4.6') // ratingAvg.toFixed(1) -- plain JS, ASCII decimal
    expect(rows[0]!.text()).toContain('۱۲') // ratingCount, fa-IR digits
    // NuxtImg renders a single <img> (the testid lands directly on it, no wrapper), and its
    // src goes through the provider's resize query string rather than staying the raw URL.
    const thumb = rows[0]!.get('[data-testid="favorite-salon-thumb"]')
    expect(thumb.element.tagName).toBe('IMG')
    expect(thumb.attributes('src')).toContain(SALON_WITH_PHOTO.coverPhoto)
    expect(rows[0]!.attributes('href')).toBe(`/salons/${SALON_WITH_PHOTO.slug}`)
  })

  it('falls back to the shared placeholder and hides the rating line for a salon with no photo or reviews', async () => {
    stub([SALON_NO_PHOTO])
    const wrapper = await mountSuspended(FavoritesPage)
    await flushPromises()

    const row = wrapper.get('[data-testid="favorite-salon"]')
    expect(row.get('[data-testid="favorite-salon-thumb"]').element.tagName).not.toBe('IMG')
    // ratingCount === 0 means "never reviewed", not "rated zero" -- the line must not render.
    expect(row.text()).not.toContain('(۰)')
  })

  it('shows an empty state, not a blank page, when nothing is saved', async () => {
    stub([])
    const wrapper = await mountSuspended(FavoritesPage)
    await flushPromises()

    expect(wrapper.find('[data-testid="favorite-salon"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="empty-state"]').text()).toContain('هنوز سالنی ذخیره نکرده‌اید')
  })

  it('links back to the profile page', async () => {
    stub([])
    const wrapper = await mountSuspended(FavoritesPage)
    await flushPromises()

    const backLink = wrapper.findAllComponents({ name: 'NuxtLink' }).find((l) => l.props('to') === '/profile')
    expect(backLink).toBeTruthy()
  })
})
