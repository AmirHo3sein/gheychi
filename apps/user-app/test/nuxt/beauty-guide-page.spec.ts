import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import GuidePage from '../../app/pages/beauty-guide/[id].vue'

const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), { create: () => fetchStub })
mockNuxtImport('useRoute', () => () => ({ params: { id: 'g1' }, query: {} }))
const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const GUIDE = {
  id: 'g1',
  status: 'ready',
  failureCode: null,
  createdAt: '2026-10-07T10:00:00.000Z',
  analyzedAt: '2026-10-07T10:00:05.000Z',
  imagePath: '/beauty-guides/g1/image',
  sourcePortfolioItemId: null,
  domain: 'hair_color',
  lookSummaryFa: 'این استایل ترکیبی از بالیاژ با روت ملت است.',
  stylistRequestFa: 'ریشه طبیعی‌تر بماند.',
  durationEstimate: { min: 180, max: 300 },
  attributes: { hair_length: 'long' },
  discussionPoints: ['سابقه دکلره قبلی'],
  maintenance: [{ text: 'تونر هر چند هفته', source: 'curated' }],
  safetyNote: null,
  concepts: [
    { key: 'balayage', nameFa: 'بالیاژ', nameEn: 'Balayage', domain: 'hair_color', confidence: 'high', source: 'ai', removed: false, evidenceFa: null, mappable: true },
    { key: 'root_melt', nameFa: 'روت ملت', nameEn: 'Root Melt', domain: 'hair_color', confidence: 'medium', source: 'ai', removed: false, evidenceFa: null, mappable: true },
  ],
}

const SALON = {
  id: 's1', name: 'سالن رنگ', slug: 'color-salon', city: 'تهران', address: 'x', ratingAvg: 4.5, ratingCount: 3, distanceKm: 2,
  minPrice: 2_000_000, coverPhoto: null, isFeatured: false, hasActiveStory: false, categories: [],
}
const MATCHES = {
  salons: [
    {
      salon: SALON,
      matchedConceptKeys: ['balayage', 'root_melt'],
      services: [
        { id: 'svc-fixed', name: 'بالیاژ', pricingType: 'fixed', price: 2_500_000, priceMax: null, discountPercent: null, durationMin: 90, durationMax: null, conceptKeys: ['balayage'], keywordMatch: true, bookableOnline: true },
        { id: 'svc-quote', name: 'اصلاح رنگ', pricingType: 'quote', price: null, priceMax: null, discountPercent: null, durationMin: 60, durationMax: null, conceptKeys: ['balayage'], keywordMatch: false, bookableOnline: false },
      ],
    },
  ],
  portfolio: [{ id: 'pf1', url: 'http://cdn/pf1.jpg', caption: 'بالیاژ', serviceId: 'svc-fixed', salonId: 's1', salonSlug: 'color-salon', salonName: 'سالن رنگ', conceptKeys: ['balayage'] }],
  unmappedConceptKeys: [],
  emptyReason: null,
}

function stub(guide: Record<string, unknown> | null, matches: unknown = MATCHES) {
  fetchMock.mockImplementation(async (path: string, options: { method?: string; body?: unknown }) => {
    if (path === '/beauty-guides/g1' && (!options?.method || options.method === 'GET')) {
      if (!guide) throw { response: { status: 404 } }
      return guide
    }
    if (path === '/beauty-guides/g1' && options.method === 'PATCH') {
      return { ...guide, concepts: (guide!.concepts as Array<Record<string, unknown>>).map((c) => (c.key === 'balayage' ? { ...c, removed: true } : c)) }
    }
    if (path === '/beauty-guides/g1/matches') return matches
    if (path === '/beauty-guides/g1/retry') return { ...GUIDE }
    if (path === '/cities') return [{ name: 'تهران', lat: 35.7, lng: 51.4 }]
    if (path === '/beauty-guides/concepts') return []
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('beauty guide page', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    clearNuxtData(['beauty-guide-g1'])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders the guide as visual sections with hedged, labelled AI content', async () => {
    stub(GUIDE)
    const wrapper = await mountSuspended(GuidePage)
    await flushPromises()
    expect(wrapper.get('[data-testid="guide-summary"]').text()).toContain('بالیاژ')
    expect(wrapper.get('[data-testid="guide-image"]').attributes('src')).toMatch(/\/beauty-guides\/g1\/image$/)
    expect(wrapper.get('[data-testid="concept-balayage"]').text()).toContain('به احتمال زیاد')
    expect(wrapper.get('[data-testid="guide-request"]').text()).toContain('ریشه طبیعی‌تر بماند')
    const duration = wrapper.get('[data-testid="guide-duration"]').text()
    expect(duration).toContain('حدود ۳ تا ۵ ساعت')
    expect(duration).toContain('تخمینی')
    expect(wrapper.get('[data-testid="guide-maintenance"]').text()).toContain('تونر')
  })

  it('shows real service prices, books fixed services via the existing flow, and never totals', async () => {
    stub(GUIDE)
    const wrapper = await mountSuspended(GuidePage)
    await flushPromises()
    const book = wrapper.get('[data-testid="guide-service-book"]')
    expect(book.attributes('href')).toBe('/booking/color-salon/svc-fixed?beautyGuideId=g1')
    expect(book.text()).toContain('۲٬۵۰۰٬۰۰۰')
    const quote = wrapper.get('[data-testid="guide-service-coordinate"]')
    expect(quote.text()).toContain('قیمت توافقی')
    expect(quote.attributes('href')).toBe('/salons/color-salon')
    expect(wrapper.get('[data-testid="guide-price-note"]').text()).toContain('هزینه نهایی بسته به خدمات انتخابی')
    expect(wrapper.text()).not.toContain('جمع')
    expect(wrapper.findAll('[data-testid="guide-portfolio-item"]')).toHaveLength(1)
  })

  it('persists a correction and re-runs matching', async () => {
    stub(GUIDE)
    const wrapper = await mountSuspended(GuidePage)
    await flushPromises()
    await wrapper.get('[data-testid="concept-balayage"] [data-testid="concept-remove"]').trigger('click')
    await flushPromises()
    const patchCall = fetchMock.mock.calls.find(([path, o]) => path === '/beauty-guides/g1' && o?.method === 'PATCH')
    expect(patchCall?.[1].body).toEqual({ removeConceptKeys: ['balayage'] })
    expect(wrapper.find('[data-testid="concept-restore-balayage"]').exists()).toBe(true)
    expect(fetchMock.mock.calls.filter(([path]) => path === '/beauty-guides/g1/matches').length).toBeGreaterThanOrEqual(2)
  })

  it('shows the helpful unsuitable message', async () => {
    stub({ ...GUIDE, status: 'unsuitable', concepts: [] })
    const wrapper = await mountSuspended(GuidePage)
    await flushPromises()
    expect(wrapper.get('[data-testid="guide-unsuitable"]').text()).toContain('این تصویر برای ساخت راهنمای زیبایی مناسب نیست')
  })

  it('shows a real failure with retry — never a fake empty result', async () => {
    stub({ ...GUIDE, status: 'failed', failureCode: 'provider_error', concepts: [], lookSummaryFa: null })
    const wrapper = await mountSuspended(GuidePage)
    await flushPromises()
    expect(wrapper.get('[data-testid="guide-failed"]').text()).toContain('خطا')
    expect(wrapper.find('[data-testid="guide-matches-empty"]').exists()).toBe(false)
    await wrapper.get('[data-testid="guide-retry"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/beauty-guides/g1/retry', expect.objectContaining({ method: 'POST' }))
    expect(wrapper.find('[data-testid="guide-summary"]').exists()).toBe(true)
  })

  it('explains an empty match list instead of a bare void', async () => {
    stub(GUIDE, { salons: [], portfolio: [], unmappedConceptKeys: [], emptyReason: null })
    const wrapper = await mountSuspended(GuidePage)
    await flushPromises()
    expect(wrapper.get('[data-testid="guide-matches-empty"]').text()).toContain('شهر دیگری')
  })

  it('shows a non-diagnostic safety note for a medical concern', async () => {
    stub({ ...GUIDE, safetyNote: 'medical_concern' })
    const wrapper = await mountSuspended(GuidePage)
    await flushPromises()
    expect(wrapper.get('[data-testid="guide-safety"]').text()).toContain('متخصص')
  })

  it('handles a guide that does not exist (or is someone else’s)', async () => {
    stub(null)
    const wrapper = await mountSuspended(GuidePage)
    await flushPromises()
    expect(wrapper.find('[data-testid="guide-not-found"]').exists()).toBe(true)
  })

  describe('deleting a guide', () => {
    function stubWithDelete() {
      stub(GUIDE)
      const base = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation(async (path: string, opts?: { method?: string }) =>
        path === '/beauty-guides/g1' && opts?.method === 'DELETE' ? null : base(path, opts),
      )
    }
    const deleteCalls = () => fetchMock.mock.calls.filter(([, o]) => o?.method === 'DELETE')

    it('asks through the in-app confirm dialog (never native confirm) and deletes nothing yet', async () => {
      const nativeConfirm = vi.fn(() => true)
      vi.stubGlobal('confirm', nativeConfirm)
      stubWithDelete()
      const wrapper = await mountSuspended(GuidePage)
      await flushPromises()

      await wrapper.get('[data-testid="guide-delete"]').trigger('click')
      expect(wrapper.get('[data-testid="guide-delete-dialog"]').attributes('role')).toBe('alertdialog')
      expect(nativeConfirm).not.toHaveBeenCalled()
      expect(deleteCalls()).toHaveLength(0)
    })

    it('deletes and returns to the guide list once confirmed', async () => {
      stubWithDelete()
      const wrapper = await mountSuspended(GuidePage)
      await flushPromises()

      await wrapper.get('[data-testid="guide-delete"]').trigger('click')
      await wrapper.get('[data-testid="guide-delete-confirm"]').trigger('click')
      await flushPromises()

      expect(deleteCalls()).toHaveLength(1)
      expect(navigateToMock).toHaveBeenCalledWith('/account/beauty-guides')
    })

    it('keeps the guide when the dialog is dismissed', async () => {
      stubWithDelete()
      const wrapper = await mountSuspended(GuidePage)
      await flushPromises()

      await wrapper.get('[data-testid="guide-delete"]').trigger('click')
      await wrapper.get('[data-testid="guide-delete-cancel"]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-testid="guide-delete-dialog"]').exists()).toBe(false)
      expect(deleteCalls()).toHaveLength(0)
      expect(navigateToMock).not.toHaveBeenCalled()
    })
  })
})
