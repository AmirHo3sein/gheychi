import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FeaturedView from './FeaturedView.vue'
import JalaliDatePicker from '@/components/ui/JalaliDatePicker.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

const SALON_NOT_FEATURED = { id: 's1', name: 'سالن الف', city: 'تهران', isFeatured: false, featuredUntil: null }
const SALON_FEATURED = { id: 's2', name: 'سالن ب', city: 'مشهد', isFeatured: true, featuredUntil: '2026-08-01T00:00:00.000Z' }

// The page only ever lists APPROVED salons -- is_featured on any other status is a flag
// SearchService.search() can never surface, and /admin/salons defaults to status=pending
// when the param is omitted. PAGE_SIZE is the endpoint's own @Max(100) cap.
const LIST_PATH = '/admin/salons?status=approved&page=1&pageSize=100'

// GET /admin/salons returns a paginated envelope in real usage (AdminSalonsController.list()
// -- { items, total, page, pageSize }), never a bare array, so the mock must match that shape.
function stub(salons: unknown[], total = salons.length) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/admin/salons?')) return { data: { items: salons, total, page: 1, pageSize: 100 }, error: null }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

async function mountView() {
  const wrapper = mount(FeaturedView)
  await flushPromises()
  return wrapper
}

describe('FeaturedView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('requests only approved salons, at the endpoint-capped page size', async () => {
    stub([SALON_NOT_FEATURED])
    await mountView()

    expect(fetchMock).toHaveBeenCalledWith(LIST_PATH, { silent: true })
  })

  it('loads and displays salons with their featured badge', async () => {
    stub([SALON_NOT_FEATURED, SALON_FEATURED])
    const wrapper = await mountView()

    const rows = wrapper.findAll('[data-testid="featured-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('سالن الف')
    expect(rows[0]!.text()).toContain('تهران')
    expect(rows[0]!.find('[data-testid="featured-badge"]').text()).toBe('خیر')
    expect(rows[1]!.find('[data-testid="featured-badge"]').text()).toBe('بله')
  })

  it('shows an empty state when there are no salons', async () => {
    stub([])
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="featured-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="featured-row"]').exists()).toBe(false)
  })

  it('shows a distinct error state (not the empty state) when the fetch fails, and retry reloads', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'Something went wrong' } })
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="featured-empty"]').exists()).toBe(false)

    stub([SALON_NOT_FEATURED])
    await wrapper.get('[data-testid="retry-load"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="load-error"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('سالن الف')
  })

  it('toggles featured status and PATCHes with the entered date, then reloads', async () => {
    stub([SALON_NOT_FEATURED])
    const wrapper = await mountView()

    // JalaliDatePicker isn't a native input -- drive its v-model contract directly, same as
    // AppSelect/AppMultiSelect elsewhere in this repo's test suites.
    await wrapper.findComponent(JalaliDatePicker).vm.$emit('update:modelValue', '2026-09-01')

    fetchMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === '/admin/salons/s1/featured' && opts?.method === 'PATCH') return { data: {}, error: null }
      if (path === LIST_PATH) {
        return { data: { items: [{ ...SALON_NOT_FEATURED, isFeatured: true }], total: 1, page: 1, pageSize: 100 }, error: null }
      }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })

    await wrapper.get('[data-testid="toggle-featured-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/salons/s1/featured',
      expect.objectContaining({
        method: 'PATCH',
        // End-of-day, not midnight: the boost is gated on `featured_until > now()`, so a
        // midnight instant would lapse at 03:30 local on the very date the field shows.
        body: { isFeatured: true, featuredUntil: new Date('2026-09-01T23:59:59.999').toISOString() },
      }),
    )
    expect(wrapper.get('[data-testid="featured-badge"]').text()).toBe('بله')
  })

  it('sends no featuredUntil when the date field is left empty, and un-features on a second toggle', async () => {
    stub([SALON_FEATURED])
    const wrapper = await mountView()

    fetchMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === '/admin/salons/s2/featured' && opts?.method === 'PATCH') return { data: {}, error: null }
      if (path === LIST_PATH) {
        return { data: { items: [{ ...SALON_FEATURED, isFeatured: false }], total: 1, page: 1, pageSize: 100 }, error: null }
      }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })

    await wrapper.get('[data-testid="toggle-featured-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/salons/s2/featured',
      expect.objectContaining({ method: 'PATCH', body: { isFeatured: false, featuredUntil: undefined } }),
    )
  })

  it('shows the per-row loading state only on the salon being saved', async () => {
    stub([SALON_NOT_FEATURED, SALON_FEATURED])
    const wrapper = await mountView()

    let resolvePatch: (value: unknown) => void = () => {}
    fetchMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === '/admin/salons/s1/featured' && opts?.method === 'PATCH') {
        return new Promise((resolve) => { resolvePatch = resolve })
      }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })

    const buttons = wrapper.findAll('[data-testid="toggle-featured-button"]')
    await buttons[0]!.trigger('click')
    await flushPromises()

    expect(buttons[0]!.attributes('aria-busy')).toBe('true')
    expect(buttons[1]!.attributes('aria-busy')).toBe('false')

    fetchMock.mockImplementation(async (path: string) => {
      if (path === LIST_PATH) return { data: { items: [SALON_NOT_FEATURED, SALON_FEATURED], total: 2, page: 1, pageSize: 100 }, error: null }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    resolvePatch({ data: {}, error: null })
    await flushPromises()
  })

  it('hides the pager on a single page and pages through a larger result set', async () => {
    stub([SALON_NOT_FEATURED], 1)
    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="featured-pager"]').exists()).toBe(false)

    // 150 approved salons -> two pages.
    stub([SALON_NOT_FEATURED], 150)
    const wrapper2 = await mountView()
    expect(wrapper2.find('[data-testid="featured-pager"]').exists()).toBe(true)
  })
})
