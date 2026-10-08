import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import SalonDetailView from './SalonDetailView.vue'
import SalonBookingSettingsCard from '@/components/salons/SalonBookingSettingsCard.vue'
import SalonSubscriptionCard from '@/components/salons/SalonSubscriptionCard.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const salon = {
  id: 's1',
  name: 'سالن نمونه',
  slug: 'salon-nemooneh',
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

const CHECK_KEYS = ['identity', 'location', 'photos', 'call', 'services']

// Approve is gated by the written review checklist; tests that approve must tick it first.
async function tickAllChecks(wrapper: { get: (s: string) => { setValue: (v: boolean) => Promise<void> } }) {
  for (const key of CHECK_KEYS) await wrapper.get(`[data-testid="check-${key}"]`).setValue(true)
}

// The enriched GET /admin/salons/:id payload (spec "API contract").
const reviewPayload = {
  ...salon,
  contactPhone: '02112345678',
  createdAt: '2026-10-01T08:00:00.000Z',
  owner: { id: 'u1', name: 'مریم احمدی', phone: '09121234567', status: 'active' },
  location: { lat: 35.7, lng: 51.4 },
  photos: [{ id: 'ph1', url: 'http://cdn.example/a.jpg', sortOrder: 0 }],
  services: [
    { id: 'sv1', name: 'کوتاهی', pricingType: 'fixed', price: 200000, priceMax: null, durationMinutes: 45, isActive: true },
  ],
  hours: [{ dayOfWeek: 6, openTime: '09:00:00', closeTime: '18:00:00', isClosed: false }],
  riskSummary: { bookingsTotal: 4, onlineBookings: 3, manualBookings: 1, cancelledBySalon: 0, rejectedBySalon: 0, noShowMarked: 0, openReports: 0 },
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
    // SalonBookingSettingsCard/SalonSubscriptionCard each fetch their own data on mount;
    // stubbing both keeps this file's sequential apiFetch mock chains about the salon record
    // itself. Their own behaviour is covered in their own spec files.
    const wrapper = mount(SalonDetailView, {
      global: {
        plugins: [router],
        stubs: { SalonBookingSettingsCard: true, SalonSubscriptionCard: true, SalonHandleCard: true },
      },
    })
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

    await tickAllChecks(wrapper)
    await wrapper.get('[data-testid="approve-button"]').trigger('click')
    await wrapper.get('[data-testid="approve-confirm"]').trigger('click')
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

    expect(wrapper.text()).toContain('سالن یافت نشد')
  })

  it('explains the cascade cause when the salon was suspended via its owner', async () => {
    fetchMock.mockResolvedValueOnce({
      data: { ...salon, status: 'suspended', suspendedCause: 'owner_suspended' },
      error: null,
    })

    const wrapper = await mountWithRouter()

    expect(wrapper.find('[data-testid="suspended-cause"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('به دلیل تعلیق حساب مالک')
    // ...and the cause reaches the actions, which must stop offering a reapprove the
    // backend would 409 anyway.
    expect((wrapper.get('[data-testid="reapprove-button"]').element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.find('[data-testid="reapprove-blocked-hint"]').exists()).toBe(true)
  })

  it('shows no cause line for a direct admin suspension', async () => {
    fetchMock.mockResolvedValueOnce({
      data: { ...salon, status: 'suspended', suspendedCause: 'admin' },
      error: null,
    })

    const wrapper = await mountWithRouter()

    expect(wrapper.find('[data-testid="suspended-cause"]').exists()).toBe(false)
    // A direct admin suspension is undone from right here, so the control stays live.
    expect((wrapper.get('[data-testid="reapprove-button"]').element as HTMLButtonElement).disabled).toBe(false)
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

    expect(wrapper.text()).toContain('استوری‌ای برای این سالن ثبت نشده است.')
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
    await card.get('[data-testid="restore-confirm"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/admin/portfolio/p1/status', {
      method: 'PATCH',
      body: { status: 'published' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(wrapper.get('[data-testid="portfolio-card"]').text()).toContain('منتشر شده')
  })

  it('shows a loading indicator while the initial salon fetch is in flight', async () => {
    let resolveFetch!: (value: { data: typeof salon; error: null }) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )
    const wrapper = await mountWithRouter()

    expect(wrapper.find('[data-testid="salon-loading"]').exists()).toBe(true)

    resolveFetch({ data: salon, error: null })
    await flushPromises()

    expect(wrapper.find('[data-testid="salon-loading"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('سالن نمونه')
  })

  it('shows a persistent, retryable error state (not a permanently blank page) when the initial load fails non-404', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'Server error' } })

    const wrapper = await mountWithRouter()

    expect(wrapper.find('[data-testid="salon-load-error"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('یافت نشد')

    fetchMock.mockResolvedValueOnce({ data: salon, error: null })
    await wrapper.get('[data-testid="salon-load-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="salon-load-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('سالن نمونه')
  })

  it('shows a distinct, retryable error state for a failed stories fetch, not a false empty state', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: salon, error: null })
      .mockResolvedValueOnce({ data: null, error: { status: 500, message: 'Server error' } })

    const wrapper = await mountWithRouter()
    await wrapper.get('[data-testid="tab-stories"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="stories-error"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('استوری‌ای برای این سالن ثبت نشده است.')

    fetchMock.mockResolvedValueOnce({ data: [activeStory], error: null })
    await wrapper.get('[data-testid="stories-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="stories-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="story-card"]').exists()).toBe(true)
  })

  it('gives content images under moderation a real, descriptive alt (not decorative alt="")', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: salon, error: null })
      .mockResolvedValueOnce({ data: [activeStory, removedExpiredStory], error: null })

    const wrapper = await mountWithRouter()
    await wrapper.get('[data-testid="tab-stories"]').trigger('click')
    await flushPromises()

    const images = wrapper.findAll('[data-testid="story-card"] img')
    // A caption present is used as the alt text; no caption falls back to a real
    // descriptive label -- never alt="".
    expect(images[0]!.attributes('alt')).toBe(activeStory.caption)
    expect(images[1]!.attributes('alt')).not.toBe('')
    expect(images[1]!.attributes('alt')).toBeTruthy()
  })

  it('shows the per-salon booking-settings and subscription cards on the info tab only', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: salon, error: null })
      // GET /admin/salons/s1/stories on tab activation
      .mockResolvedValueOnce({ data: [], error: null })

    const wrapper = await mountWithRouter()
    expect(wrapper.findComponent(SalonBookingSettingsCard).exists()).toBe(true)
    expect(wrapper.findComponent(SalonBookingSettingsCard).props('salonId')).toBe('s1')
    expect(wrapper.findComponent(SalonSubscriptionCard).exists()).toBe(true)
    expect(wrapper.findComponent(SalonSubscriptionCard).props('salonId')).toBe('s1')

    // The showcase tabs are moderation surfaces -- neither settings card belongs there.
    await wrapper.get('[data-testid="tab-stories"]').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(SalonBookingSettingsCard).exists()).toBe(false)
    expect(wrapper.findComponent(SalonSubscriptionCard).exists()).toBe(false)
  })

  it('marks the tab control with ARIA tab semantics', async () => {
    fetchMock.mockResolvedValueOnce({ data: salon, error: null })
    const wrapper = await mountWithRouter()

    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
    const infoTab = wrapper.get('[data-testid="tab-info"]')
    expect(infoTab.attributes('role')).toBe('tab')
    expect(infoTab.attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[data-testid="tab-stories"]').attributes('aria-selected')).toBe('false')
  })

  it('wires tabs to their panel and uses a roving tabindex', async () => {
    fetchMock.mockResolvedValueOnce({ data: salon, error: null })
    const wrapper = await mountWithRouter()

    const infoTab = wrapper.get('[data-testid="tab-info"]')
    const storiesTab = wrapper.get('[data-testid="tab-stories"]')
    expect(infoTab.attributes('tabindex')).toBe('0')
    expect(storiesTab.attributes('tabindex')).toBe('-1')
    const panel = wrapper.get('[role="tabpanel"]')
    expect(panel.attributes('id')).toBe(infoTab.attributes('aria-controls'))
    expect(panel.attributes('aria-labelledby')).toBe(infoTab.attributes('id'))
  })

  it('moves between tabs with the arrow keys following the RTL visual order', async () => {
    fetchMock.mockResolvedValueOnce({ data: salon, error: null })
    fetchMock.mockResolvedValue({ data: [], error: null })
    const wrapper = await mountWithRouter()

    // First tab is on the right in RTL: ArrowLeft goes to the next one, ArrowRight back.
    await wrapper.get('[data-testid="tab-info"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.get('[data-testid="tab-stories"]').attributes('aria-selected')).toBe('true')
    await wrapper.get('[data-testid="tab-stories"]').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.get('[data-testid="tab-info"]').attributes('aria-selected')).toBe('true')
    // Wraps from the first tab to the last.
    await wrapper.get('[data-testid="tab-info"]').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.get('[data-testid="tab-portfolio"]').attributes('aria-selected')).toBe('true')
    await wrapper.get('[data-testid="tab-portfolio"]').trigger('keydown', { key: 'Home' })
    expect(wrapper.get('[data-testid="tab-info"]').attributes('aria-selected')).toBe('true')
    await wrapper.get('[data-testid="tab-info"]').trigger('keydown', { key: 'End' })
    expect(wrapper.get('[data-testid="tab-portfolio"]').attributes('aria-selected')).toBe('true')
  })

  describe('approval review', () => {
    it('shows the review panel and keeps Approve disabled until every checklist item is ticked', async () => {
      fetchMock.mockResolvedValueOnce({ data: reviewPayload, error: null })
      const wrapper = await mountWithRouter()

      expect(wrapper.find('[data-testid="review-panel"]').exists()).toBe(true)
      const approve = () => wrapper.get('[data-testid="approve-button"]').element as HTMLButtonElement
      expect(approve().disabled).toBe(true)
      expect(wrapper.find('[data-testid="approve-blocked-hint"]').exists()).toBe(true)

      // One short of complete is still blocked -- the gate is "all", not "any".
      for (const key of CHECK_KEYS.slice(0, -1)) await wrapper.get(`[data-testid="check-${key}"]`).setValue(true)
      expect(approve().disabled).toBe(true)

      await wrapper.get('[data-testid="check-services"]').setValue(true)
      expect(approve().disabled).toBe(false)
      expect(wrapper.find('[data-testid="approve-blocked-hint"]').exists()).toBe(false)

      // Un-ticking re-blocks it.
      await wrapper.get('[data-testid="check-call"]').setValue(false)
      expect(approve().disabled).toBe(true)
    })

    it('never gates Reject behind the checklist', async () => {
      fetchMock.mockResolvedValueOnce({ data: reviewPayload, error: null })
      const wrapper = await mountWithRouter()

      expect((wrapper.get('[data-testid="reject-button"]').element as HTMLButtonElement).disabled).toBe(false)
    })

    it('offers no checklist for a salon that is not pending', async () => {
      fetchMock.mockResolvedValueOnce({ data: { ...reviewPayload, status: 'approved' }, error: null })
      const wrapper = await mountWithRouter()

      expect(wrapper.find('[data-testid="approval-checklist"]').exists()).toBe(false)
      expect((wrapper.get('[data-testid="suspend-button"]').element as HTMLButtonElement).disabled).toBe(false)
    })

    it('still renders (without the panel) if the API sends only the base salon fields', async () => {
      fetchMock.mockResolvedValueOnce({ data: salon, error: null })
      const wrapper = await mountWithRouter()

      expect(wrapper.find('[data-testid="review-panel"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('سالن نمونه')
    })
  })
})
