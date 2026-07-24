import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import AdminFeaturedPage from '../../app/pages/admin/featured.vue'

// Same pattern as bookings-list.spec.ts: this page loads via onMounted (not a
// top-level useAsyncData await), so every test mounts then awaits flushPromises()
// before asserting. $fetch is a real globalThis binding, not an unimport-tracked
// auto-import, so it's stubbed directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const SALON_NOT_FEATURED = { id: 's1', name: 'سالن الف', city: 'تهران', isFeatured: false, featuredUntil: null }
const SALON_FEATURED = { id: 's2', name: 'سالن ب', city: 'مشهد', isFeatured: true, featuredUntil: '2026-08-01T00:00:00.000Z' }

// GET /admin/salons returns a paginated envelope in real usage (AdminSalonsController.list()
// -- { items, total, page, pageSize }), never a bare array, so the mock must match that shape.
function stub(salons: unknown[]) {
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/admin/salons') return { items: salons, total: salons.length, page: 1, pageSize: 20 }
    throw new Error(`unexpected fetch path in test: ${path}`)
  })
}

describe('admin featured page', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a loading state before the initial load resolves', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve }))

    wrapper = await mountSuspended(AdminFeaturedPage)
    expect(wrapper.text()).toContain('در حال بارگذاری')

    resolveFetch({ items: [], total: 0, page: 1, pageSize: 20 })
    await flushPromises()
    expect(wrapper.text()).not.toContain('در حال بارگذاری')
  })

  it('renders each salon row with its featured badge', async () => {
    stub([SALON_NOT_FEATURED, SALON_FEATURED])
    wrapper = await mountSuspended(AdminFeaturedPage)
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="featured-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('سالن الف')
    expect(rows[0]!.find('[data-testid="featured-badge"]').text()).toBe('خیر')
    expect(rows[1]!.find('[data-testid="featured-badge"]').text()).toBe('بله')
  })

  it('shows an empty state when there are no salons', async () => {
    stub([])
    wrapper = await mountSuspended(AdminFeaturedPage)
    await flushPromises()

    expect(wrapper.find('[data-testid="featured-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="featured-row"]').exists()).toBe(false)
  })

  it('toggles featured status and PATCHes with the entered date, then reloads', async () => {
    stub([SALON_NOT_FEATURED])
    wrapper = await mountSuspended(AdminFeaturedPage)
    await flushPromises()

    const dateInput = wrapper.get('[data-testid="featured-until-input"]')
    await dateInput.setValue('2026-09-01')

    fetchMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === '/admin/salons/s1/featured' && opts?.method === 'PATCH') return {}
      if (path === '/admin/salons') {
        return { items: [{ ...SALON_NOT_FEATURED, isFeatured: true }], total: 1, page: 1, pageSize: 20 }
      }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })

    await wrapper.get('[data-testid="toggle-featured-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/salons/s1/featured',
      expect.objectContaining({
        method: 'PATCH',
        body: { isFeatured: true, featuredUntil: new Date('2026-09-01').toISOString() },
      }),
    )
  })

  it('shows the per-row loading state only on the salon being saved', async () => {
    stub([SALON_NOT_FEATURED, SALON_FEATURED])
    wrapper = await mountSuspended(AdminFeaturedPage)
    await flushPromises()

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
      if (path === '/admin/salons') {
        return { items: [SALON_NOT_FEATURED, SALON_FEATURED], total: 2, page: 1, pageSize: 20 }
      }
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    resolvePatch({})
    await flushPromises()
  })
})
