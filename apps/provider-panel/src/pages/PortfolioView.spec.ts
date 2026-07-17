import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

    await wrapper.findAll('[data-testid="item-service"]')[1]!.setValue('')
    expect(fetchMock).toHaveBeenCalledWith('/salons/mine/portfolio/pf2', { method: 'PATCH', body: { serviceId: null } })
  })

  it('shows the cap meter and the removed badge on the admin-removed item only', async () => {
    const wrapper = await mountView()

    expect(wrapper.get('[data-testid="cap-meter"]').text()).toContain('۲ از ۴۰ نمونه کار')
    const badges = wrapper.findAll('[data-testid="removed-badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.text()).toBe('توسط مدیر حذف شد')
  })
})
