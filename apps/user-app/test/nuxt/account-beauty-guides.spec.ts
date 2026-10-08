import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import BeautyGuidesPage from '../../app/pages/account/beauty-guides.vue'

const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), { create: () => fetchStub })

const GUIDE = {
  id: 'g1',
  status: 'ready',
  createdAt: '2026-10-07T10:00:00.000Z',
  imagePath: '/beauty-guides/g1/image',
  concepts: [{ key: 'balayage', nameFa: 'بالیاژ', nameEn: 'Balayage', confidence: 'high', source: 'ai', removed: false }],
}

describe('account beauty guides page', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    clearNuxtData(['beauty-guides'])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists guides and does not show the empty state', async () => {
    fetchMock.mockResolvedValue([GUIDE])
    const wrapper = await mountSuspended(BeautyGuidesPage)
    await flushPromises()
    expect(wrapper.findAll('[data-testid="guide-history-item"]')).toHaveLength(1)
    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(false)
  })

  it('shows the empty state only for a genuinely empty list', async () => {
    fetchMock.mockResolvedValue([])
    const wrapper = await mountSuspended(BeautyGuidesPage)
    await flushPromises()
    expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('هنوز راهنمایی نساخته‌اید')
  })

  it('shows a retry card for a transient failure, and retrying recovers', async () => {
    fetchMock.mockRejectedValue({ response: { status: 500 } })
    const wrapper = await mountSuspended(BeautyGuidesPage)
    await flushPromises()

    expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="guides-error"]').attributes('role')).toBe('alert')

    fetchMock.mockResolvedValue([GUIDE])
    await wrapper.get('[data-testid="guides-retry-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="guides-error"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="guide-history-item"]')).toHaveLength(1)
  })

  it('says the feature is unavailable (no retry) when the API refuses it with 403/404', async () => {
    fetchMock.mockRejectedValue({ response: { status: 404 } })
    const wrapper = await mountSuspended(BeautyGuidesPage)
    await flushPromises()
    expect(wrapper.get('[data-testid="guides-unavailable"]').text()).toContain('در دسترس نیست')
    expect(wrapper.find('[data-testid="guides-retry-button"]').exists()).toBe(false)
  })

  it('has a >=44px back button', async () => {
    fetchMock.mockResolvedValue([])
    const wrapper = await mountSuspended(BeautyGuidesPage)
    expect(wrapper.get('a[aria-label="بازگشت"]').classes()).toEqual(expect.arrayContaining(['h-11', 'w-11']))
  })
})
