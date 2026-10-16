import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SalonReviewPanel from './SalonReviewPanel.vue'
import type { SalonReviewData } from '@/utils/salon-review'
import { resetToast, useToast } from '@/composables/useToast'

const fetchMock = vi.fn()
vi.mock('@/composables/useApi', () => ({ useApi: () => ({ apiFetch: fetchMock }) }))

const base: SalonReviewData = {
  address: 'خیابان ولیعصر',
  city: 'تهران',
  contactPhone: '02112345678',
  createdAt: '2026-10-01T08:00:00.000Z',
  owner: { id: 'u1', name: 'مریم احمدی', phone: '09121234567', status: 'active' },
  location: { lat: 35.7, lng: 51.4 },
  photos: [
    { id: 'b', url: 'http://cdn/2.jpg', sortOrder: 1 },
    { id: 'a', url: 'http://cdn/1.jpg', sortOrder: 0 },
  ],
  services: [
    { id: 's1', name: 'کوتاهی', pricingType: 'fixed', price: 200000, priceMax: null, durationMinutes: 45, isActive: true },
    { id: 's2', name: 'رنگ', pricingType: 'from', price: 500000, priceMax: null, durationMinutes: 90, isActive: true },
    { id: 's3', name: 'مش', pricingType: 'range', price: 300000, priceMax: 600000, durationMinutes: 120, isActive: true },
    { id: 's4', name: 'کراتین', pricingType: 'quote', price: null, priceMax: null, durationMinutes: 60, isActive: false },
  ],
  hours: [{ dayOfWeek: 6, openTime: '09:00:00', closeTime: '18:00:00', isClosed: false }],
  riskSummary: { bookingsTotal: 10, onlineBookings: 8, manualBookings: 2, cancelledBySalon: 3, rejectedBySalon: 0, noShowMarked: 1, openReports: 0 },
}

const mountPanel = (over: Partial<SalonReviewData> = {}) => mount(SalonReviewPanel, { props: { salon: { ...base, ...over } } })

describe('SalonReviewPanel', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
  })

  it('shows the owner phone as a tel: link with the owner account status', () => {
    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('مریم احمدی')
    expect(wrapper.get('[data-testid="owner-phone"]').attributes('href')).toBe('tel:09121234567')
    // Displayed in Persian digits; the dialable href and the title (copy source) stay ASCII.
    expect(wrapper.get('[data-testid="owner-phone"]').text()).toBe('۰۹۱۲۱۲۳۴۵۶۷')
    expect(wrapper.get('[data-testid="owner-phone"]').attributes('title')).toBe('09121234567')
    expect(wrapper.get('[data-testid="owner-status"]').text()).toContain('فعال')
  })

  it('flags a suspended owner account', () => {
    const wrapper = mountPanel({ owner: { ...base.owner, status: 'suspended' } })
    expect(wrapper.get('[data-testid="owner-status"]').text()).toContain('معلق')
  })

  it('links the contact phone, or says plainly it was not provided', () => {
    expect(mountPanel().get('[data-testid="contact-phone"]').attributes('href')).toBe('tel:02112345678')
    expect(mountPanel().get('[data-testid="contact-phone"]').text()).toBe('۰۲۱۱۲۳۴۵۶۷۸')
    const missing = mountPanel({ contactPhone: null })
    expect(missing.find('[data-testid="contact-phone"]').exists()).toBe(false)
    expect(missing.get('[data-testid="contact-phone-missing"]').text()).toBe('ثبت نشده')
  })

  it('renders a map preview tile, a pin and an external map link', () => {
    const wrapper = mountPanel()
    expect(wrapper.get('[data-testid="map-preview"] img').attributes('src')).toMatch(/^https:\/\/tile\.openstreetmap\.org\/16\/\d+\/\d+\.png$/)
    expect(wrapper.find('[data-testid="map-pin"]').exists()).toBe(true)
    const link = wrapper.get('[data-testid="map-link"]')
    expect(link.text()).toBe('مشاهده روی نقشه')
    expect(link.attributes('href')).toContain('openstreetmap.org')
    expect(link.attributes('rel')).toContain('noopener')
  })

  it('warns when the salon has no location instead of rendering an empty map', () => {
    const wrapper = mountPanel({ location: null })
    expect(wrapper.find('[data-testid="map-preview"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="no-location"]').text()).toContain('ثبت نشده')
  })

  it('renders photos in sortOrder and warns when there are none', () => {
    const items = mountPanel().findAll('[data-testid="photo-item"] img')
    expect(items.map((i) => i.attributes('src'))).toEqual(['http://cdn/1.jpg', 'http://cdn/2.jpg'])
    expect(mountPanel({ photos: [] }).find('[data-testid="no-photos"]').exists()).toBe(true)
  })

  it('degrades a broken photo to the fallback', async () => {
    const wrapper = mountPanel()
    await wrapper.get('[data-testid="photo-item"] img').trigger('error')
    expect(wrapper.find('[data-testid="image-fallback"]').exists()).toBe(true)
  })

  it('shows each pricing type honestly and marks inactive services', () => {
    const rows = mountPanel().findAll('[data-testid="service-row"]')
    expect(rows[0]!.text()).toContain('۲۰۰٬۰۰۰ تومان')
    expect(rows[1]!.text()).toContain('از ۵۰۰٬۰۰۰ تومان')
    expect(rows[2]!.text()).toContain('۳۰۰٬۰۰۰ تا ۶۰۰٬۰۰۰ تومان')
    expect(rows[3]!.text()).toContain('پس از استعلام')
    expect(rows[3]!.text()).toContain('غیرفعال')
  })

  it('shows a service photo thumbnail only for services that have one', () => {
    const services = base.services.map((s) => (s.id === 's2' ? { ...s, imageUrl: 'http://cdn/svc2.jpg' } : { ...s, imageUrl: null }))
    const rows = mountPanel({ services }).findAll('[data-testid="service-row"]')
    const link = rows[1]!.get('[data-testid="service-image"]')
    expect(link.attributes('href')).toBe('http://cdn/svc2.jpg')
    expect(link.attributes('rel')).toContain('noopener')
    expect(link.get('img').attributes('alt')).toBe('رنگ')
    for (const i of [0, 2, 3]) expect(rows[i]!.find('[data-testid="service-image"]').exists()).toBe(false)
  })

  it('uses the icon-only fallback for a broken service thumbnail', async () => {
    const services = base.services.map((s) => (s.id === 's2' ? { ...s, imageUrl: 'http://cdn/svc2.jpg' } : s))
    const wrapper = mountPanel({ services })
    await wrapper.get('[data-testid="service-image"] img').trigger('error')
    const fallback = wrapper.get('[data-testid="service-image"] [data-testid="image-fallback"]')
    expect(fallback.text()).toBe('')
    expect(fallback.attributes('aria-label')).toBe('رنگ (بارگذاری نشد)')
  })

  it('offers an image takedown only for services that have an image', () => {
    const services = base.services.map((s) => (s.id === 's2' ? { ...s, imageUrl: 'http://cdn/svc2.jpg' } : { ...s, imageUrl: null }))
    const rows = mountPanel({ services }).findAll('[data-testid="service-row"]')
    expect(rows[1]!.get('[data-testid="remove-service-image"]').attributes('aria-label')).toBe('حذف تصویر خدمت رنگ')
    for (const i of [0, 2, 3]) expect(rows[i]!.find('[data-testid="remove-service-image"]').exists()).toBe(false)
  })

  // The panel no longer hides a taken-down image itself: it forwards the removal to the detail
  // page, which owns the salon payload and refetches it (SalonDetailView.spec covers the row
  // update and focus). Replaces the earlier local-state + focusable "removed"-cell tests.
  it('forwards a confirmed takedown to the detail page as image-removed', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 's2', imageUrl: null }, error: null })
    const services = base.services.map((s) => (s.id === 's2' || s.id === 's3' ? { ...s, imageUrl: `http://cdn/${s.id}.jpg` } : s))
    const wrapper = mountPanel({ services })
    const row = () => wrapper.findAll('[data-testid="service-row"]')[1]!

    await row().get('[data-testid="remove-service-image"]').trigger('click')
    expect(fetchMock).not.toHaveBeenCalled()
    await row().get('[data-testid="remove-service-image-confirm"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/admin/services/s2/image', { method: 'DELETE', silent: true })
    expect(wrapper.emitted('image-removed')).toEqual([['s2']])
    expect(useToast().toasts.value.some((t) => t.tone === 'success')).toBe(true)
  })

  it('says an admin removed the image when imageRemovedByAdminAt is set and no image remains', () => {
    const services = base.services.map((s) =>
      s.id === 's2' ? { ...s, imageUrl: null, imageRemovedByAdminAt: '2026-10-09T10:00:00.000Z' } : { ...s, imageUrl: null },
    )
    const wrapper = mountPanel({ services })
    expect(wrapper.get('[data-testid="service-image-removed-s2"]').text()).toBe('حذف‌شده توسط مدیر')
    expect(wrapper.find('[data-testid="service-image-none-s2"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="service-image-none-s1"]').text()).toBe('—')
  })

  it('keeps the service image when the takedown fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'خطایی رخ داد' } })
    const services = base.services.map((s) => (s.id === 's2' ? { ...s, imageUrl: 'http://cdn/svc2.jpg' } : s))
    const wrapper = mountPanel({ services })
    const row = () => wrapper.findAll('[data-testid="service-row"]')[1]!
    await row().get('[data-testid="remove-service-image"]').trigger('click')
    await row().get('[data-testid="remove-service-image-confirm"]').trigger('click')
    await flushPromises()

    expect(row().find('[data-testid="service-image"]').exists()).toBe(true)
    expect(row().find('[data-testid="remove-service-image"]').exists()).toBe(true)
  })

  it('lists the week Saturday-first with closed days marked', () => {
    const days = mountPanel().findAll('[data-testid="hours-day"]')
    expect(days).toHaveLength(7)
    expect(days[0]!.text()).toBe('۰۹:۰۰ تا ۱۸:۰۰')
    expect(days[1]!.text()).toBe('تعطیل')
  })

  it('renders the 90-day counters with plain labels and highlights only non-zero warnings', () => {
    const stats = mountPanel().findAll('[data-testid="risk-stat"]')
    expect(stats).toHaveLength(7)
    const byLabel = (label: string) => stats.find((s) => s.text().includes(label))!
    expect(byLabel('لغو از طرف سالن').text()).toContain('۳')
    expect(byLabel('لغو از طرف سالن').find('dd').classes()).toContain('text-(--tone-danger-text)')
    expect(byLabel('گزارش باز').find('dd').classes()).not.toContain('text-(--tone-danger-text)')
    expect(byLabel('کل نوبت‌ها').find('dd').classes()).not.toContain('text-(--tone-danger-text)')
  })
})
