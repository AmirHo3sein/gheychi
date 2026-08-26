import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppSelect from '@/components/ui/AppSelect.vue'
import { resetFeatureFlags } from '@/composables/useFeatureFlags'
import { resetToast } from '@/composables/useToast'
import PortfolioView from './PortfolioView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const items = [
  {
    id: 'pf1',
    url: 'http://localhost:3002/uploads/salons/s1/portfolio/a.jpg',
    caption: 'قبل و بعد رنگ',
    serviceId: null,
    status: 'published',
    sortOrder: 0,
    createdAt: '2026-07-10T10:00:00.000Z',
  },
  {
    id: 'pf2',
    url: 'http://localhost:3002/uploads/salons/s1/portfolio/b.jpg',
    caption: null,
    serviceId: 'svc-1',
    status: 'removed',
    sortOrder: 1,
    createdAt: '2026-07-11T10:00:00.000Z',
  },
]
const services = [{ id: 'svc-1', name: 'کوتاهی مو' }]

async function mountView() {
  const wrapper = mount(PortfolioView)
  await wrapper.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 0))
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('PortfolioView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    resetToast()
    resetFeatureFlags()
    fetchMock.mockImplementation((path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
      // Clone list responses so in-place row mutations in the component never leak
      // back into the shared fixtures across tests.
      if (path === '/salons/mine/portfolio') return Promise.resolve({ data: structuredClone(items), error: null })
      if (path === '/salons/mine/services') return Promise.resolve({ data: structuredClone(services), error: null })
      if (options?.method === 'PATCH' && path.startsWith('/salons/mine/portfolio/')) {
        const id = path.split('/').pop()
        const item = items.find((i) => i.id === id)
        return Promise.resolve({ data: { ...structuredClone(item), ...options.body }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })
  })

  it('shows the "hidden from customers" banner when portfolio is disabled, but still renders items', async () => {
    const { useFeatureFlags } = await import('@/composables/useFeatureFlags')
    useFeatureFlags().flags.value = {
      reviewsEnabled: true,
      storiesEnabled: true,
      portfolioEnabled: false,
      referralsEnabled: true,
      couponsEnabled: true,
    }
    const wrapper = await mountView()

    expect(wrapper.get('[data-testid="portfolio-disabled-banner"]').text()).toContain('موقتاً برای مشتریان غیرفعال است')
    expect(wrapper.get('[data-testid="cap-meter"]').text()).toContain('۲ از ۴۰ نمونه کار')
    wrapper.unmount()
  })

  it('shows no banner when portfolio is enabled', async () => {
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="portfolio-disabled-banner"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('reorders by swapping the two adjacent items sortOrders via PATCH, then refetches', async () => {
    const wrapper = await mountView()

    // First card's move-up is disabled (already first).
    expect((wrapper.findAll('[data-testid="move-up"]')[0]!.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.findAll('[data-testid="move-up"]')[1]!.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalledWith('/salons/mine/portfolio/pf2', { method: 'PATCH', body: { sortOrder: 0 } })
    expect(fetchMock).toHaveBeenCalledWith('/salons/mine/portfolio/pf1', { method: 'PATCH', body: { sortOrder: 1 } })
  })

  it('PATCHes an edited caption on blur and skips a no-op blur', async () => {
    const wrapper = await mountView()

    const caption = wrapper.findAll('[data-testid="item-caption"]')[0]!
    await caption.setValue('کار جدید')
    await caption.trigger('blur')
    expect(fetchMock).toHaveBeenCalledWith('/salons/mine/portfolio/pf1', { method: 'PATCH', body: { caption: 'کار جدید' } })

    fetchMock.mockClear()
    await caption.trigger('blur')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears the caption with caption: null when the input is emptied', async () => {
    const wrapper = await mountView()

    const caption = wrapper.findAll('[data-testid="item-caption"]')[0]!
    await caption.setValue('  ')
    await caption.trigger('blur')
    expect(fetchMock).toHaveBeenCalledWith('/salons/mine/portfolio/pf1', { method: 'PATCH', body: { caption: null } })

    // The cleared value is now the saved state: a repeat empty blur is a no-op.
    fetchMock.mockClear()
    await caption.setValue('')
    await caption.trigger('blur')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears the linked service with serviceId: null when «بدون خدمت مرتبط» is picked', async () => {
    const wrapper = await mountView()

    // AppSelect wraps vue-multiselect (no native <select> to setValue), so drive its
    // contract instead. The service pickers are the only AppSelects on this page -- one per
    // portfolio item, rendered in item order -- so index 1 is the second item's (pf2).
    wrapper.findAllComponents(AppSelect)[1]!.vm.$emit('update:modelValue', '')
    await wrapper.vm.$nextTick()
    expect(fetchMock).toHaveBeenCalledWith('/salons/mine/portfolio/pf2', { method: 'PATCH', body: { serviceId: null } })
  })

  it('shows the cap meter and the removed badge on the admin-removed item only', async () => {
    const wrapper = await mountView()

    expect(wrapper.get('[data-testid="cap-meter"]').text()).toContain('۲ از ۴۰ نمونه کار')
    const badges = wrapper.findAll('[data-testid="removed-badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.text()).toBe('توسط مدیر حذف شد')
  })

  it('asks for confirmation before deleting an item, and skips the DELETE if declined', async () => {
    const wrapper = await mountView()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    await wrapper.findAll('[data-testid="delete-item"]')[0]!.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(confirmSpy).toHaveBeenCalledWith('این نمونه کار حذف شود؟')
    expect(fetchMock).not.toHaveBeenCalledWith('/salons/mine/portfolio/pf1', { method: 'DELETE' })

    confirmSpy.mockRestore()
  })

  it('DELETEs and refetches once confirmation is accepted', async () => {
    const wrapper = await mountView()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    await wrapper.findAll('[data-testid="delete-item"]')[0]!.trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalledWith('/salons/mine/portfolio/pf1', { method: 'DELETE' })

    confirmSpy.mockRestore()
  })

  it('resyncs the caption draft with the trimmed server value after a successful save', async () => {
    const wrapper = await mountView()

    const caption = wrapper.findAll('[data-testid="item-caption"]')[0]!
    await caption.setValue('  کار جدید  ')
    await caption.trigger('blur')
    await new Promise((r) => setTimeout(r, 0))

    expect((caption.element as HTMLInputElement).value).toBe('کار جدید')
  })

  it('shows a retry state when the initial load fails, and recovers on retry', async () => {
    fetchMock.mockReset()
    fetchMock.mockImplementation((path: string) => {
      if (path === '/salons/mine/portfolio') return Promise.resolve({ data: null, error: { message: 'boom' } })
      if (path === '/salons/mine/services') return Promise.resolve({ data: structuredClone(services), error: null })
      return Promise.resolve({ data: null, error: null })
    })

    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="retry-portfolio"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="item-caption"]').exists()).toBe(false)

    fetchMock.mockImplementation((path: string) => {
      if (path === '/salons/mine/portfolio') return Promise.resolve({ data: structuredClone(items), error: null })
      if (path === '/salons/mine/services') return Promise.resolve({ data: structuredClone(services), error: null })
      return Promise.resolve({ data: null, error: null })
    })
    await wrapper.get('[data-testid="retry-portfolio"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="retry-portfolio"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="item-caption"]')).toHaveLength(2)
  })
})
