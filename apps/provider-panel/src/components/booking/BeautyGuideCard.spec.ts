import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BeautyGuideCard from './BeautyGuideCard.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const GUIDE = {
  id: 'g1',
  status: 'ready',
  failureCode: null,
  createdAt: '2030-06-01T09:00:00.000Z',
  analyzedAt: '2030-06-01T09:00:05.000Z',
  imagePath: '/salons/mine/bookings/b1/beauty-guide/image',
  sourcePortfolioItemId: null,
  domain: 'hair_color',
  lookSummaryFa: 'بالیاژ روشن با لایه‌های بلند',
  stylistRequestFa: 'بالیاژ عسلی با ریشه طبیعی می‌خواهم',
  durationEstimate: { min: 180, max: 300 },
  attributes: { hair_length: 'long', hair_color_family: 'blonde' },
  discussionPoints: ['رنگ فعلی مو', 'سابقه دکلره'],
  maintenance: [],
  safetyNote: null,
  concepts: [
    { key: 'balayage', nameFa: 'بالیاژ', nameEn: 'Balayage', domain: 'hair_color', confidence: 'high', source: 'ai', removed: false, evidenceFa: null, mappable: true },
    { key: 'root_melt', nameFa: 'روت ملت', nameEn: 'Root melt', domain: 'hair_color', confidence: 'medium', source: 'ai', removed: false, evidenceFa: null, mappable: true },
    { key: 'gloss_toner', nameFa: 'تونر', nameEn: 'Gloss toner', domain: 'hair_color', confidence: 'low', source: 'ai', removed: false, evidenceFa: null, mappable: true },
    { key: 'layered_cut', nameFa: 'کوتاهی لایه‌ای', nameEn: 'Layered cut', domain: 'hair_cut_style', confidence: 'low', source: 'user', removed: false, evidenceFa: null, mappable: true },
    { key: 'ombre', nameFa: 'آمبره', nameEn: 'Ombre', domain: 'hair_color', confidence: 'high', source: 'ai', removed: true, evidenceFa: null, mappable: true },
  ],
}

async function mountExpanded(response: unknown) {
  fetchMock.mockResolvedValueOnce(response)
  const wrapper = mount(BeautyGuideCard, { props: { bookingId: 'b1' } })
  await wrapper.get('[data-testid="beauty-guide-toggle"]').trigger('click')
  await flushPromises()
  return wrapper
}

describe('BeautyGuideCard', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('is collapsed by default and fetches nothing until expanded', () => {
    const wrapper = mount(BeautyGuideCard, { props: { bookingId: 'b1' } })
    expect(wrapper.get('[data-testid="beauty-guide-toggle"]').text()).toContain('مشاهده راهنمای زیبایی مشتری')
    expect(wrapper.find('[data-testid="beauty-guide-image"]').exists()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches on expand and renders the image, summary, request, concepts and attributes', async () => {
    const wrapper = await mountExpanded({ data: GUIDE, error: null })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe('/salons/mine/bookings/b1/beauty-guide')
    const img = wrapper.get('[data-testid="beauty-guide-image"]')
    expect(img.attributes('src')).toMatch(/\/api\/salons\/mine\/bookings\/b1\/beauty-guide\/image$/)
    expect(img.attributes('alt')).toBeTruthy()
    expect(wrapper.get('[data-testid="beauty-guide-summary"]').text()).toBe(GUIDE.lookSummaryFa)
    expect(wrapper.get('[data-testid="beauty-guide-request"]').text()).toBe(GUIDE.stylistRequestFa)
    expect(wrapper.get('[data-testid="beauty-guide-concept-balayage"]').text()).toContain('بالیاژ (Balayage)')
    // A concept the customer removed is not shown at all.
    expect(wrapper.find('[data-testid="beauty-guide-concept-ombre"]').exists()).toBe(false)
    const attrs = wrapper.get('[data-testid="beauty-guide-attributes"]').text()
    expect(attrs).toContain('بلندی مو')
    expect(attrs).toContain('بلند')
    expect(attrs).toContain('بلوند')
    expect(wrapper.get('[data-testid="beauty-guide-discussion"]').text()).toContain('نکات قابل گفتگو')
  })

  it('words confidence as hedged Persian, labels customer-added concepts, never shows numbers', async () => {
    const wrapper = await mountExpanded({ data: GUIDE, error: null })
    expect(wrapper.get('[data-testid="beauty-guide-concept-balayage"]').text()).toContain('به احتمال زیاد')
    expect(wrapper.get('[data-testid="beauty-guide-concept-root_melt"]').text()).toContain('احتمالاً')
    expect(wrapper.get('[data-testid="beauty-guide-concept-gloss_toner"]').text()).toContain('شاید')
    expect(wrapper.get('[data-testid="beauty-guide-concept-layered_cut"]').text()).toContain('تأیید مشتری')
    expect(wrapper.get('[data-testid="beauty-guide-concepts"]').text()).not.toMatch(/[0-9۰-۹%]/)
  })

  it('labels the duration as an AI estimate and says the booking keeps its real duration/price', async () => {
    const wrapper = await mountExpanded({ data: GUIDE, error: null })
    const text = wrapper.get('[data-testid="beauty-guide-duration"]').text()
    expect(text).toContain('زمان تقریبی (تخمین هوش مصنوعی)')
    expect(text).toContain('حدود ۳ تا ۵ ساعت')
    expect(text).toContain('مدت و قیمت این نوبت')
  })

  it('shows a neutral consultation note for a medical concern', async () => {
    const wrapper = await mountExpanded({ data: { ...GUIDE, safetyNote: 'medical_concern' }, error: null })
    expect(wrapper.get('[data-testid="beauty-guide-medical"]').text()).toContain('مشاوره با متخصص')
  })

  it('omits the medical note when there is no safety concern', async () => {
    const wrapper = await mountExpanded({ data: GUIDE, error: null })
    expect(wrapper.find('[data-testid="beauty-guide-medical"]').exists()).toBe(false)
  })

  it('shows a "no longer available" state on 404', async () => {
    const wrapper = await mountExpanded({ data: null, error: { status: 404, message: 'x' } })
    expect(wrapper.get('[data-testid="beauty-guide-gone"]').text()).toContain('راهنما دیگر در دسترس نیست')
    expect(wrapper.find('[data-testid="beauty-guide-retry"]').exists()).toBe(false)
  })

  it('shows an error with retry, and retrying loads the guide', async () => {
    const wrapper = await mountExpanded({ data: null, error: { status: 500, message: 'x' } })
    expect(wrapper.find('[data-testid="beauty-guide-error"]').exists()).toBe(true)

    fetchMock.mockResolvedValueOnce({ data: GUIDE, error: null })
    await wrapper.get('[data-testid="beauty-guide-retry"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="beauty-guide-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="beauty-guide-image"]').exists()).toBe(true)
  })

  it('does not refetch when collapsed and re-expanded', async () => {
    const wrapper = await mountExpanded({ data: GUIDE, error: null })
    await wrapper.get('[data-testid="beauty-guide-toggle"]').trigger('click')
    await wrapper.get('[data-testid="beauty-guide-toggle"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
