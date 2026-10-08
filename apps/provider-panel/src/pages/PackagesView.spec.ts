import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetToast } from '@/composables/useToast'
import PackagesView from './PackagesView.vue'
import { autoConfirm } from '@/test-utils/auto-confirm'

const SERVICES = [
  { id: 'svc-1', name: 'آرایش', isActive: true },
  { id: 'svc-2', name: 'شینیون', isActive: true },
  { id: 'svc-3', name: 'ابرو', isActive: true },
]

const PACKAGE = {
  id: 'pkg-1',
  name: 'پکیج عروس',
  description: null,
  isActive: true,
  pricingType: 'from' as const,
  price: 2500000,
  priceMax: null,
  items: [
    { serviceId: 'svc-1', name: 'آرایش', pricingType: 'fixed' as const, price: 500000, durationMin: 60 },
    { serviceId: 'svc-2', name: 'شینیون', pricingType: 'fixed' as const, price: 500000, durationMin: 60 },
  ],
}

describe('PackagesView', () => {
  beforeEach(() => {
    resetToast()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders existing packages with their items and price display', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [PACKAGE] }) // GET packages
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => SERVICES }) // GET services
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PackagesView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('پکیج عروس')
    expect(wrapper.text()).toContain('از')
    expect(wrapper.text()).toContain('آرایش')
    expect(wrapper.text()).toContain('شینیون')
  })

  it('shows an empty state with no packages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => SERVICES })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PackagesView)
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('هنوز پکیجی ثبت نشده است')
  })

  it('rejects creating a package with fewer than 2 services selected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => SERVICES })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PackagesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('input[placeholder="نام پکیج، مثلاً: پکیج عروس"]').setValue('پکیج تست')
    await wrapper.get('[data-testid="package-service-checkbox-svc-1"]').trigger('change')
    await wrapper.get('[data-testid="add-package"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).toContain('یک پکیج باید حداقل شامل ۲ خدمت باشد')
    expect(fetchMock.mock.calls.length).toBe(2)
  })

  it('creates a package with 2 services and a FROM price', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [] }) // GET packages
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => SERVICES }) // GET services
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => PACKAGE }) // POST
      .mockResolvedValue({ ok: true, status: 200, json: async () => [PACKAGE] }) // reload
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(PackagesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.find('input[placeholder="نام پکیج، مثلاً: پکیج عروس"]').setValue('پکیج عروس')
    await wrapper.get('[data-testid="package-service-checkbox-svc-1"]').trigger('change')
    await wrapper.get('[data-testid="package-service-checkbox-svc-2"]').trigger('change')
    await wrapper.get('[data-testid="new-package-pricing-type-from"] input[type="radio"]').setValue(true)
    await wrapper.get('[data-testid="new-package-price-input"]').setValue('2500000')
    await wrapper.get('[data-testid="add-package"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    const postCall = fetchMock.mock.calls.find((c) => (c[1] as { method?: string })?.method === 'POST')!
    const body = JSON.parse((postCall[1] as { body: string }).body)
    expect(body).toMatchObject({ name: 'پکیج عروس', pricingType: 'from', price: 2500000, serviceIds: ['svc-1', 'svc-2'] })
  })

  it('archives a package after confirmation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [PACKAGE] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => SERVICES })
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null })
    vi.stubGlobal('fetch', fetchMock)
    autoConfirm(true)

    const wrapper = mount(PackagesView)
    await new Promise((r) => setTimeout(r, 0))

    await wrapper.get('[data-testid="archive-package"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.text()).not.toContain('پکیج عروس')
  })
})
