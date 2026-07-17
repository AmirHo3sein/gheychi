import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import SalonDetailView from './SalonDetailView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const salon = {
  id: 's1',
  name: 'سالن نمونه',
  description: null,
  status: 'pending',
  genderTarget: 'women',
  address: 'خیابان اصلی',
  city: 'تهران',
  capacity: 3,
  rejectionReason: null,
  suspendedCause: null,
}

const activeStory = {
  id: 'st1',
  url: 'http://cdn.example/story1.jpg',
  caption: 'کوتاهی مو',
  serviceId: null,
  status: 'published',
  createdAt: '2026-07-17T08:00:00.000Z',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
}

// Removed AND expired at once -- the admin list hides nothing, so both flags render.
const removedExpiredStory = {
  id: 'st2',
  url: 'http://cdn.example/story2.jpg',
  caption: null,
  serviceId: null,
  status: 'removed',
  createdAt: '2026-07-15T08:00:00.000Z',
  expiresAt: new Date(Date.now() - 3600_000).toISOString(),
}

const portfolioItem = {
  id: 'p1',
  url: 'http://cdn.example/work1.jpg',
  caption: 'رنگ و مش',
  serviceId: null,
  status: 'removed',
  sortOrder: 0,
  createdAt: '2026-07-10T08:00:00.000Z',
}

describe('SalonDetailView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  async function mountWithRouter() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/salons/:id', name: 'salon-detail', component: SalonDetailView }],
    })
    router.push('/salons/s1')
    await router.isReady()
    const wrapper = mount(SalonDetailView, { global: { plugins: [router] } })
    await flushPromises()
    return wrapper
  }

  it('does not flip to not-found or clear salon state when the post-action refetch fails transiently', async () => {
    fetchMock
      // initial onMounted load
      .mockResolvedValueOnce({ data: salon, error: null })
      // approve PATCH triggered by SalonStatusActions
      .mockResolvedValueOnce({ data: { id: 's1', status: 'approved' }, error: null })
      // refetch triggered by onUpdated -- fails transiently (not a 404)
      .mockResolvedValueOnce({ data: null, error: { status: 0, message: 'Network error' } })

    const wrapper = await mountWithRouter()
    expect(wrapper.text()).toContain('سالن نمونه')

    await wrapper.get('[data-testid="approve-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(wrapper.text()).not.toContain('یافت نشد')
    expect(wrapper.text()).toContain('سالن نمونه')
    // Status renders through the Farsi label map (StatusBadge), not the raw API enum value.
    expect(wrapper.text()).toContain('تایید شده')
  })

  it('shows the not-found message on a confirmed 404', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 404, message: 'Not Found' } })

    const wrapper = await mountWithRouter()

    expect(wrapper.text()).toContain('آرایشگاه یافت نشد')
  })

  it('explains the cascade cause when the salon was suspended via its owner', async () => {
    fetchMock.mockResolvedValueOnce({
      data: { ...salon, status: 'suspended', suspendedCause: 'owner_suspended' },
      error: null,
    })

    const wrapper = await mountWithRouter()

    expect(wrapper.find('[data-testid="suspended-cause"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('به دلیل تعلیق حساب مالک')
  })

  it('shows no cause line for a direct admin suspension', async () => {
    fetchMock.mockResolvedValueOnce({
      data: { ...salon, status: 'suspended', suspendedCause: 'admin' },
      error: null,
    })

    const wrapper = await mountWithRouter()

    expect(wrapper.find('[data-testid="suspended-cause"]').exists()).toBe(false)
  })

  it('loads stories lazily on first tab activation, flagging removed and expired rows', async () => {
    fetchMock
      // initial onMounted load
      .mockResolvedValueOnce({ data: salon, error: null })
      // GET /admin/salons/s1/stories on tab activation
      .mockResolvedValueOnce({ data: [activeStory, removedExpiredStory], error: null })

    const wrapper = await mountWithRouter()
    // Nothing showcase-related is fetched until the tab is opened.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await wrapper.get('[data-testid="tab-stories"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/stories', { silent: true })
    const cards = wrapper.findAll('[data-testid="story-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.text()).toContain('کوتاهی مو')
    // Status renders through the Farsi label map; expiry is a derived badge, not a status.
    expect(cards[0]!.find('[data-testid="expired-badge"]').exists()).toBe(false)
    expect(cards[1]!.text()).toContain('حذف شده')
    expect(cards[1]!.get('[data-testid="expired-badge"]').text()).toContain('منقضی شده')

    // Re-activating the tab reuses the already-loaded list -- no duplicate fetch.
    await wrapper.get('[data-testid="tab-info"]').trigger('click')
    await wrapper.get('[data-testid="tab-stories"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows an empty state when the salon has no stories', async () => {
    fetchMock
      // initial onMounted load
      .mockResolvedValueOnce({ data: salon, error: null })
      // GET /admin/salons/s1/stories -- empty
      .mockResolvedValueOnce({ data: [], error: null })

    const wrapper = await mountWithRouter()
    await wrapper.get('[data-testid="tab-stories"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('استوری‌ای برای این آرایشگاه ثبت نشده است.')
  })

  it('removes a story with a reason and reloads the list', async () => {
    fetchMock
      // initial onMounted load
      .mockResolvedValueOnce({ data: salon, error: null })
      // GET /admin/salons/s1/stories on tab activation
      .mockResolvedValueOnce({ data: [activeStory], error: null })
      // PATCH /admin/stories/st1/status
      .mockResolvedValueOnce({ data: { ...activeStory, status: 'removed' }, error: null })
      // reload after the action
      .mockResolvedValueOnce({ data: [{ ...activeStory, status: 'removed' }], error: null })

    const wrapper = await mountWithRouter()
    await wrapper.get('[data-testid="tab-stories"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="remove-button"]').trigger('click')
    await wrapper.get('[data-testid="remove-reason-input"]').setValue('محتوای نامناسب')
    await wrapper.get('[data-testid="remove-submit"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/stories/st1/status', {
      method: 'PATCH',
      body: { status: 'removed', reason: 'محتوای نامناسب' },
    })
    // The list was re-fetched after the action and the row now shows its new status.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(wrapper.get('[data-testid="story-card"]').text()).toContain('حذف شده')
  })

  it('restores a removed portfolio item and reloads the list', async () => {
    fetchMock
      // initial onMounted load
      .mockResolvedValueOnce({ data: salon, error: null })
      // GET /admin/salons/s1/portfolio on tab activation
      .mockResolvedValueOnce({ data: [portfolioItem], error: null })
      // PATCH /admin/portfolio/p1/status
      .mockResolvedValueOnce({ data: { ...portfolioItem, status: 'published' }, error: null })
      // reload after the action
      .mockResolvedValueOnce({ data: [{ ...portfolioItem, status: 'published' }], error: null })

    const wrapper = await mountWithRouter()
    await wrapper.get('[data-testid="tab-portfolio"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/portfolio', { silent: true })
    const card = wrapper.get('[data-testid="portfolio-card"]')
    expect(card.text()).toContain('رنگ و مش')
    expect(card.text()).toContain('حذف شده')

    await card.get('[data-testid="restore-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/portfolio/p1/status', {
      method: 'PATCH',
      body: { status: 'published' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(wrapper.get('[data-testid="portfolio-card"]').text()).toContain('منتشر شده')
  })
})
